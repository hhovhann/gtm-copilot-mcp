import { describe, expect, it } from "vitest";
import { insertDraft } from "../db/drafts.js";
import { fixedClock, makeApp } from "../db/testing.js";
import { DISCLAIMER } from "../economics/render.js";
import { realEconomics } from "../economics/testing.js";
import { realSdrConfig } from "../sdr/testing.js";
import { EconomicsError } from "../economics/model.js";
import { estimateCostInputSchema, estimateCostTool, type EconomicsDeps } from "./estimateCost.js";

async function setup(drafts = 12) {
  const app = makeApp();
  const res = await app.post({ email: "secret.person@orbitbank.example", firstName: "Qwertyfirst", lastName: "Qwertylast", source: "demo_request" });
  const leadId = ((await res.json()) as { leadId: number }).leadId;
  for (let i = 0; i < drafts; i++) {
    insertDraft(app.db, {
      leadId, createdAt: "2026-10-08T12:00:00.000Z", status: i % 4 === 3 ? "blocked" : "pending_review", subject: "SECRETSUBJECT", body: "SECRETBODY", claims: [],
      guardrails: { status: "passed", checks: [], notChecked: [] }, contentHash: "h", drafter: "local", model: i % 2 ? "model-b" : "model-a",
      promptVersion: "p", inputTokens: 400, outputTokens: 100, estCostUsd: 0,
    });
  }
  const deps: EconomicsDeps = { db: app.db, clock: fixedClock, economics: realEconomics(), sdrConfig: realSdrConfig() };
  return { deps, db: app.db };
}
const parse = (out: string[]) => JSON.parse(out[1]!);

describe("input schema", () => {
  const ok = (v: unknown) => estimateCostInputSchema.safeParse(v).success;
  it("accepts an empty call and sensible values", () => {
    expect(ok({})).toBe(true);
    expect(ok({ leadsPerMonth: 5000, scenarios: ["build", "buy"], overrides: { replyRate: 0.05 } })).toBe(true);
  });
  it.each([
    [{ leadsPerMonth: 9 }], [{ leadsPerMonth: 1_000_001 }], [{ leadsPerMonth: 100.5 }], [{ scenarios: ["outsource"] }], [{ scenarios: [] }],
    [{ overrides: { replyRate: 1.1 } }], [{ overrides: { replyRate: -0.1 } }], [{ overrides: { passRate: 0 } }], [{ overrides: { touchesPerLead: 11 } }],
    [{ overrides: { reviewMinutesPerDraft: 61 } }], [{ overrides: { loadedHourlyRate: 501 } }], [{ overrides: { vendorName: "x" } }], [{ measuredModel: "" }],
  ])("rejects %j", (v) => expect(ok(v)).toBe(false));
});

describe("estimate_cost_per_meeting", () => {
  it("returns a table and JSON with all three scenarios, crossovers, sensitivity and a recommendation", async () => {
    const { deps } = await setup();
    const [text, json] = estimateCostTool(deps, {});
    const r = parse([text, json!]);
    expect(r.scenarios.map((s: { id: string }) => s.id)).toEqual(["build", "buy", "hybrid"]);
    expect(r.sensitivity).toHaveLength(10);
    expect(r.recommendation.winner).toMatch(/^(build|buy|hybrid)$/);
    expect(r.recommendation.summary).toMatch(/Cheapest at these inputs/);
    expect(text).toMatch(/Cost per meeting at 2,000 leads per month/);
    expect(text).toMatch(/Where the money goes, per meeting/);
    expect(text).toMatch(/Recommendation:/);
  });

  it("tags every input as measured, assumption or override, and says what was measured", async () => {
    const { deps } = await setup();
    const [text, json] = estimateCostTool(deps, { overrides: { replyRate: 0.08 } });
    const r = parse([text, json!]);
    expect(r.inputs.replyRate).toEqual({ value: 0.08, source: "override" });
    expect(r.inputs.showRate.source).toBe("assumption");
    expect(r.inputs.passRate.source).toBe("measured");
    expect(r.inputs.avgInputTokens).toEqual({ value: 400, source: "measured" });
    for (const v of Object.values(r.inputs) as { source: string }[]) expect(["measured", "assumption", "override"]).toContain(v.source);
    expect(text).toMatch(/replyRate = 0.08 \[override\]/);
    expect(text).toMatch(/showRate = 0.75 \[assumption\]/);
    expect(text).toMatch(/passRate = 0\.7\d{0,3} \[measured\]/); // rounded for reading, never 0.7333333333333333
    expect(text).not.toMatch(/\d\.\d{6,}/);
    expect(r.inputs.passRate.value).toBe(0.75); // the JSON keeps full precision
    expect(text).toMatch(/Measured from 12 stored drafts \(model-a, model-b\)/);
  });

  it("prices measured tokens at the production model's list rates and labels it a projection", async () => {
    const { deps } = await setup();
    const r = parse(estimateCostTool(deps, {}));
    expect(r.measured.pricedAt).toBe("claude-sonnet-5-5 list rates $2 / $10 per MTok, as of 2026-10-06 (projection)");
    expect(r.inputs.inputPricePerMTok.value).toBe(2);
    expect(r.inputs.outputPricePerMTok.value).toBe(10);
  });

  it("carries the disclaimer in both the text and the JSON", async () => {
    const { deps } = await setup();
    const [text, json] = estimateCostTool(deps, {});
    expect(text).toContain(DISCLAIMER);
    expect(parse([text, json!]).disclaimer).toBe(DISCLAIMER);
    expect(DISCLAIMER).toMatch(/not benchmarks, not Krisp's figures and not vendor quotes/);
  });

  it("falls back to assumed usage with too few drafts, and says so in the text", async () => {
    const { deps } = await setup(3);
    const [text, json] = estimateCostTool(deps, {});
    const r = parse([text, json!]);
    expect(r.measured.source).toBe("assumption");
    expect(r.inputs.passRate.source).toBe("assumption");
    expect(text).toMatch(/Not measured: only 3 model drafts/);
  });

  it("narrows measurement to one model", async () => {
    const { deps } = await setup(24);
    const r = parse(estimateCostTool(deps, { measuredModel: "model-a" }));
    expect(r.measured).toMatchObject({ source: "measured", drafts: 12, models: ["model-a"] });
  });

  it("a measured pass rate flows into LLM cost: overriding it changes the result", async () => {
    const { deps } = await setup();
    const base = parse(estimateCostTool(deps, {}));
    const lower = parse(estimateCostTool(deps, { overrides: { passRate: 0.1 } }));
    const llm = (r: typeof base) => r.scenarios.find((s: { id: string }) => s.id === "build").llmPerLead;
    expect(llm(lower)).toBeGreaterThan(llm(base));
    const buyOf = (r: typeof base) => r.scenarios.find((s: { id: string }) => s.id === "buy").llmPerLead;
    expect(buyOf(lower)).toBe(0);
  });

  it("limits the comparison to the scenarios asked for", async () => {
    const { deps } = await setup();
    const r = parse(estimateCostTool(deps, { scenarios: ["build", "buy"] }));
    expect(r.scenarios.map((s: { id: string }) => s.id)).toEqual(["build", "buy"]);
    const one = parse(estimateCostTool(deps, { scenarios: ["hybrid"] }));
    expect(one.sensitivity).toEqual([]);
    expect(one.recommendation.summary).toMatch(/Only one scenario/);
  });

  it("gives a clear error, not Infinity, when a rate of 0 means no meetings", async () => {
    const { deps } = await setup();
    expect(() => estimateCostTool(deps, { overrides: { replyRate: 0 } })).toThrow(EconomicsError);
    expect(() => estimateCostTool(deps, { overrides: { showRate: 0 } })).toThrow(/showRate is 0/);
  });

  it("is deterministic", async () => {
    const { deps } = await setup();
    expect(estimateCostTool(deps, { leadsPerMonth: 3000 })).toEqual(estimateCostTool(deps, { leadsPerMonth: 3000 }));
  });

  it("changes volume through leadsPerMonth and tags it", async () => {
    const { deps } = await setup();
    const r = parse(estimateCostTool(deps, { leadsPerMonth: 10_000 }));
    expect(r.inputs.leadsPerMonth).toEqual({ value: 10_000, source: "override" });
  });

  it("contains no lead data or draft text", async () => {
    const { deps } = await setup();
    const all = estimateCostTool(deps, {}).join("\n");
    for (const needle of ["secret.person", "Qwerty", "SECRETSUBJECT", "SECRETBODY", "@"]) expect(all, needle).not.toContain(needle);
  });

  it("writes one audit row holding only the tool name and numbers", async () => {
    const { deps, db } = await setup();
    estimateCostTool(deps, { leadsPerMonth: 4000, scenarios: ["build", "buy"] });
    const rows = db.prepare("SELECT actor, detail_json FROM audit_log WHERE action = 'tool_call'").all() as { actor: string; detail_json: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe("mcp");
    expect(JSON.parse(rows[0]!.detail_json)).toEqual({ tool: "estimate_cost_per_meeting", leadsPerMonth: 4000, scenarios: 2 });
  });
});

describe("the placeholder numbers cannot pass for evidence", () => {
  it("scenario labels and descriptions name no vendor", () => {
    const text = JSON.stringify(realEconomics().scenarios.map((s) => [s.label, s.description]));
    for (const vendor of ["Outreach", "Salesloft", "Apollo", "11x", "Artisan", "Clay", "HubSpot", "Regie", "Instantly", "Smartlead"]) expect(text).not.toContain(vendor);
  });
});
