import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { fixedClock, makeApp, validBody } from "./db/testing.js";
import { realEconomics } from "./economics/testing.js";
import { createServer } from "./server.js";
import { realEnricher, realConfig } from "./leads/testing.js";
import { ScriptedDrafter, realFacts, realSdrConfig } from "./sdr/testing.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const suppressionFile = (entries: { type: "email" | "domain"; value: string; reason: string }[]) => {
  const dir = mkdtempSync(join(tmpdir(), "gtm-supp-"));
  dirs.push(dir);
  const path = join(dir, "suppression.json");
  const write = (e: typeof entries) => writeFileSync(path, JSON.stringify({ _note: "test", entries: e }));
  write(entries);
  return { path, write };
};

/** A real MCP client talking to the real server over an in-memory transport. */
async function connect(opts: { suppression?: ReturnType<typeof suppressionFile> } = {}) {
  const app = makeApp();
  const drafter = new ScriptedDrafter();
  const supp = opts.suppression ?? suppressionFile([]);
  const server = createServer({
    db: app.db, clock: fixedClock, enricher: realEnricher(), routingConfig: realConfig(), economics: realEconomics(),
    sdr: { drafter, facts: realFacts(), config: realSdrConfig(), suppressionFile: supp.path },
  });
  const client = new Client({ name: "test-client", version: "0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    return { isError: r.isError === true, text: r.content.map((c) => c.text).join("\n") };
  };
  let n = 0;
  const seed = async (body: Record<string, unknown> = {}) =>
    ((await (await app.post(validBody(body), { "idempotency-key": `s${++n}` })).json()) as { leadId: number }).leadId;
  return { client, call, seed, drafter, supp, app };
}

describe("the MCP server, called through a real MCP client", () => {
  it("lists all eleven tools", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["approve_draft", "audit_domain", "draft_email", "estimate_cost_per_meeting", "explain_lead", "get_draft", "list_drafts", "list_leads", "ping", "reject_draft", "route_lead"]);
  });

  it("marks read-only tools as read-only and gives every tool a description and schema", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    for (const t of tools) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.inputSchema.type, t.name).toBe("object");
    }
    const ro = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(ro).toEqual(["estimate_cost_per_meeting", "get_draft", "list_drafts"]);
  });

  it("answers ping", async () => {
    expect((await (await connect()).call("ping", { message: "hi" })).text).toBe("pong: hi");
  });

  it("runs the full draft, review and approve flow", async () => {
    const { call, seed } = await connect();
    const leadId = await seed();
    const draft = await call("draft_email", { leadId });
    expect(draft.isError).toBe(false);
    const hash = /reviewedHash: "([0-9a-f]{64})"/.exec(draft.text)![1]!;
    expect((await call("approve_draft", { draftId: 1, reviewedHash: "0".repeat(64) })).isError).toBe(true);
    const ok = await call("approve_draft", { draftId: 1, reviewedHash: hash });
    expect(ok.isError).toBe(false);
    expect(ok.text).toMatch(/nothing was sent/i);
    expect((await call("list_drafts", { status: "approved" })).text).toMatch(/#1 lead #1 approved/);
  });

  it("turns expected failures into tool errors with a clear message, not protocol errors", async () => {
    const { call } = await connect();
    const r = await call("get_draft", { draftId: 999 });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toMatch(/No draft with id 999/);
  });

  it("rejects invalid input at the protocol boundary", async () => {
    const { call } = await connect();
    const r = await call("list_drafts", { limit: 21 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/limit/);
  });

  it("a missing drafter configuration fails the draft tool only, not the whole server", async () => {
    const app = makeApp();
    const server = createServer({ db: app.db, clock: fixedClock, enricher: realEnricher(), routingConfig: realConfig(), sdr: { facts: realFacts(), config: realSdrConfig() } });
    const client = new Client({ name: "t", version: "0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const prev = process.env["SDR_DRAFTER"];
    process.env["SDR_DRAFTER"] = "anthropic";
    try {
      const bad = (await client.callTool({ name: "draft_email", arguments: { leadId: 1 } })) as { isError?: boolean; content: { text: string }[] };
      expect(bad.isError).toBe(true);
      expect(bad.content[0]!.text).toMatch(/Phase 5c/);
      const ping = (await client.callTool({ name: "ping", arguments: {} })) as { isError?: boolean };
      expect(ping.isError).toBeFalsy();
    } finally {
      if (prev === undefined) delete process.env["SDR_DRAFTER"]; else process.env["SDR_DRAFTER"] = prev;
    }
  });
});

describe("opt-outs take effect immediately, with no restart", () => {
  const OPTED_OUT = { email: "later.optout@orbitbank.example", title: "VP Operations" };

  it("a lead added to the suppression file after the server started is skipped on the next draft", async () => {
    const supp = suppressionFile([]);
    const { call, seed, drafter } = await connect({ suppression: supp });
    const leadId = await seed(OPTED_OUT);

    const before = await call("draft_email", { leadId });
    expect(before.text).toMatch(/Draft #1/);
    expect(drafter.calls).toHaveLength(1);

    supp.write([{ type: "email", value: OPTED_OUT.email, reason: "asked to stop" }]); // the server is NOT restarted
    const after = await call("draft_email", { leadId });
    expect(after.text).toMatch(/suppression list/);
    expect(drafter.calls).toHaveLength(1); // the model was not called again
  });

  it("works for a whole domain, and removing the entry restores drafting", async () => {
    const supp = suppressionFile([]);
    const { call, seed, drafter } = await connect({ suppression: supp });
    const leadId = await seed({ email: "anyone@orbitbank.example" });
    supp.write([{ type: "domain", value: "orbitbank.example", reason: "company opt-out" }]);
    expect((await call("draft_email", { leadId })).text).toMatch(/suppression list/);
    expect(drafter.calls).toHaveLength(0);
    supp.write([]);
    expect((await call("draft_email", { leadId })).text).toMatch(/Draft #1/);
  });

  it("a malformed suppression file fails the draft closed instead of silently allowing everyone", async () => {
    const supp = suppressionFile([]);
    const { call, seed, drafter } = await connect({ suppression: supp });
    const leadId = await seed();
    writeFileSync(supp.path, "{ not json");
    await expect(call("draft_email", { leadId })).resolves.toMatchObject({ isError: true });
    expect(drafter.calls).toHaveLength(0);
  });
});
