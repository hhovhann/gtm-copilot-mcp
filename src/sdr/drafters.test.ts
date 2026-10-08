import { describe, expect, it, vi } from "vitest";
import { DrafterUnavailableError, type DraftRequest } from "./drafter.js";
import { appendFooter } from "./footer.js";
import { runGuardrails } from "./guardrails.js";
import { cleanModelText, DRAFT_JSON_SCHEMA, LocalDrafter } from "./localDrafter.js";
import { createDrafter } from "./select.js";
import { factsForQueue } from "./config.js";
import { TEMPLATE_NAME, TemplateDrafter } from "./templateDrafter.js";
import { goodFields, realFacts, realSdrConfig } from "./testing.js";

const cfg = realSdrConfig();
const LOCAL = { ...cfg.local };
const req: DraftRequest = {
  prompt: { system: "SYS", user: "USER" },
  context: { firstName: "Vera", companyName: "Orbit Bank", queue: "enterprise_ae", facts: factsForQueue(realFacts(), "enterprise_ae") },
};

const reply = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ model: "stub-model", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 40 }, ...extra }), { status: 200 });
const stub = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => fn(String(url), init ?? {})) as unknown as typeof fetch;
const drafter = (f: typeof fetch) => new LocalDrafter(LOCAL, { fetch: f });

describe("LocalDrafter request", () => {
  it("posts a strict json_schema request to /chat/completions with the configured settings", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = stub((url, init) => { seen = { url, init }; return reply(JSON.stringify(goodFields())); });
    await drafter(f).draft(req);
    const body = JSON.parse(String(seen!.init.body));
    expect(seen!.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(seen!.init.method).toBe("POST");
    expect(body).toMatchObject({ model: LOCAL.model, temperature: LOCAL.temperature, max_tokens: LOCAL.maxTokens });
    expect(body.messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "USER" }]);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "draft", strict: true } });
    expect(JSON.stringify(seen!.init.headers)).not.toMatch(/authorization/i);
    expect(seen!.init.signal).toBeDefined();
  });
  it("sends no tools", async () => {
    let body: Record<string, unknown> = {};
    await drafter(stub((_u, init) => { body = JSON.parse(String(init.body)); return reply(JSON.stringify(goodFields())); })).draft(req);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });
  it("asks for an object with exactly the four fields and no extras", () => {
    expect(DRAFT_JSON_SCHEMA).toMatchObject({ type: "object", additionalProperties: false, required: ["subject", "body", "claimsUsed", "cta"] });
    expect(DRAFT_JSON_SCHEMA).not.toHaveProperty("$schema");
  });
});

describe("LocalDrafter results", () => {
  it("parses a valid reply and reports usage and the serving model", async () => {
    const r = await drafter(stub(() => reply(JSON.stringify(goodFields())))).draft(req);
    expect(r).toMatchObject({ ok: true, usage: { inputTokens: 100, outputTokens: 40 }, model: "stub-model", drafter: "local" });
    if (r.ok) expect(r.draft.claimsUsed).toEqual(["F-NC-01"]);
  });
  it("strips a leading <think> block and markdown fences", async () => {
    const wrapped = `<think>let me plan this\n{"not":"it"}</think>\n\`\`\`json\n${JSON.stringify(goodFields())}\n\`\`\``;
    expect((await drafter(stub(() => reply(wrapped))).draft(req)).ok).toBe(true);
    expect(cleanModelText("<think>x</think>  hi")).toBe("hi");
  });
  it("maps finish_reason length to output_truncated and keeps usage", async () => {
    const f = stub(() => new Response(JSON.stringify({ choices: [{ message: { content: '{"subject":"cut' }, finish_reason: "length" }], usage: { prompt_tokens: 9, completion_tokens: 1500 } })));
    expect(await drafter(f).draft(req)).toMatchObject({ ok: false, code: "output_truncated", usage: { inputTokens: 9, outputTokens: 1500 } });
  });
  it.each([
    ["not JSON", reply("Sure! Here is your email.")],
    ["a JSON array", reply("[1,2]")],
    ["a missing field", reply(JSON.stringify({ subject: "s", body: "b", claimsUsed: [] }))],
    ["a bad cta", reply(JSON.stringify({ ...goodFields(), cta: "buy_now" }))],
    ["empty content", reply("   ")],
    ["null content", reply(null)],
    ["no choices", new Response(JSON.stringify({ choices: [] }))],
    ["an unparseable body", new Response("<html>oops</html>")],
  ])("marks %s as invalid_model_output even when the server claimed to enforce the schema", async (_n, res) => {
    expect(await drafter(stub(() => res)).draft(req)).toMatchObject({ ok: false, code: "invalid_model_output" });
  });
});

describe("LocalDrafter errors", () => {
  it("turns connection refused into an error that names LM Studio and the URL", async () => {
    const f = stub(() => { throw new TypeError("fetch failed"); });
    const err = await drafter(f).draft(req).catch((e) => e);
    expect(err).toBeInstanceOf(DrafterUnavailableError);
    expect(err.message).toMatch(/LM Studio/);
    expect(err.message).toContain("http://127.0.0.1:1234/v1");
  });
  it("turns a timeout into a clear error", async () => {
    const f = stub(() => { throw new DOMException("timed out", "TimeoutError"); });
    await expect(drafter(f).draft(req)).rejects.toThrow(/did not answer within 180s/);
  });
  it("turns an HTTP error into a clear error with a bounded body", async () => {
    const f = stub(() => new Response("x".repeat(5000), { status: 500 }));
    const err = await drafter(f).draft(req).catch((e) => e);
    expect(err.message).toMatch(/HTTP 500/);
    expect(err.message.length).toBeLessThan(400);
  });
});

describe("loopback only", () => {
  it("refuses a remote base URL by default and allows it with the explicit flag", () => {
    expect(() => new LocalDrafter({ ...LOCAL, baseUrl: "http://llm.example.com:1234/v1" })).toThrow(/must be loopback/);
    expect(() => new LocalDrafter({ ...LOCAL, baseUrl: "http://10.0.0.5:1234/v1" })).toThrow(/loopback/);
    expect(() => new LocalDrafter({ ...LOCAL, baseUrl: "http://llm.example.com:1234/v1" }, { allowRemote: true })).not.toThrow();
  });
  it.each(["http://127.0.0.1:1234/v1", "http://localhost:1234/v1", "http://[::1]:1234/v1"])("accepts %s", (baseUrl) => {
    expect(() => new LocalDrafter({ ...LOCAL, baseUrl })).not.toThrow();
  });
});

describe("createDrafter (SDR_DRAFTER)", () => {
  it("defaults to the local drafter and applies SDR_LOCAL_* overrides", async () => {
    let body: Record<string, unknown> = {}; let url = "";
    const f = stub((u, init) => { url = u; body = JSON.parse(String(init.body)); return reply(JSON.stringify(goodFields())); });
    const d = createDrafter(cfg, { SDR_LOCAL_MODEL: "qwen/qwen3-14b", SDR_LOCAL_BASE_URL: "http://localhost:4321/v1" }, f);
    expect(d.name).toBe("local");
    await d.draft(req);
    expect(body["model"]).toBe("qwen/qwen3-14b");
    expect(url).toBe("http://localhost:4321/v1/chat/completions");
  });
  it("selects the template drafter", () => expect(createDrafter(cfg, { SDR_DRAFTER: "template" }).name).toBe("template"));
  it("reserves anthropic for Phase 5c and never falls back silently", () => {
    expect(() => createDrafter(cfg, { SDR_DRAFTER: "anthropic" })).toThrow(/Phase 5c/);
    expect(() => createDrafter(cfg, { SDR_DRAFTER: "gpt" })).toThrow(/Unknown SDR_DRAFTER/);
  });
  it("refuses a non-loopback SDR_LOCAL_BASE_URL unless SDR_ALLOW_REMOTE_LLM=1", () => {
    const env = { SDR_LOCAL_BASE_URL: "http://llm.example.com/v1" };
    expect(() => createDrafter(cfg, env)).toThrow(/loopback/);
    expect(() => createDrafter(cfg, { ...env, SDR_ALLOW_REMOTE_LLM: "1" })).not.toThrow();
  });
});

describe("TemplateDrafter", () => {
  it("is labeled, free, and deterministic", async () => {
    const a = await new TemplateDrafter().draft(req);
    const b = await new TemplateDrafter().draft(req);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, model: TEMPLATE_NAME, drafter: "template", usage: { inputTokens: 0, outputTokens: 0 } });
  });
  it.each(cfg.draftableQueues)("writes a draft that passes every guardrail for %s", async (queue) => {
    const facts = factsForQueue(realFacts(), queue);
    const r = await new TemplateDrafter().draft({ ...req, context: { firstName: "Dana", companyName: "Example Co", queue, facts } });
    if (!r.ok) throw new Error("template failed");
    const report = runGuardrails(
      { subject: r.draft.subject, body: r.draft.body, finalBody: appendFooter(r.draft.body, cfg), claimsUsed: r.draft.claimsUsed, queue, allowedLiterals: ["Example Co", "Dana"], flags: [] },
      realFacts(), cfg,
    );
    expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(report.status).toBe("passed");
  });
  it("falls back to 'your team' with no company name", async () => {
    const r = await new TemplateDrafter().draft({ ...req, context: { ...req.context, companyName: undefined } });
    if (r.ok) expect(r.draft.subject).toContain("your team");
  });
});
