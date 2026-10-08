import { describe, expect, it } from "vitest";
import { loadConfig } from "../leads/config.js";
import { count, fixedClock, makeApp, validBody } from "../db/testing.js";
import { readFileSync } from "node:fs";
import { ToolError } from "./errors.js";
import { explainLeadTool, explainLeadInputSchema } from "./explainLead.js";
import { listLeadsInputSchema, listLeadsTool } from "./listLeads.js";

const shippedConfigJson = () => JSON.parse(readFileSync(new URL("../../config/routing.json", import.meta.url), "utf8"));

describe("explain_lead", () => {
  it("returns the stored breakdown, trace, hash and timestamps", async () => {
    const { post, db } = makeApp();
    const { leadId } = await (await post(validBody())).json();
    const [summary, json] = explainLeadTool(db, fixedClock, { leadId });
    const body = JSON.parse(json!);
    expect(summary).toContain("stored decision, not recomputed");
    expect(summary).toContain("Enterprise AE");
    expect(body.receivedAt).toBe("2026-10-08T12:00:00.000Z");
    expect(body.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.decision.scoreBreakdown.length).toBeGreaterThan(0);
    expect(body.decision.route.trace.at(-1).matched).toBe(true);
  });
  it("is unchanged after the routing config changes", async () => {
    const { post, db } = makeApp();
    const { leadId } = await (await post(validBody())).json();
    const before = explainLeadTool(db, fixedClock, { leadId });

    const changed = shippedConfigJson();
    changed.routing.rules.find((r: any) => r.id === "enterprise").when.minScore = 99;
    const second = makeApp({ db, config: loadConfig(changed) });
    const later = await (await second.post(validBody({ email: "other@orbitbank.example" }))).json();

    expect(later.queue).toBe("midmarket_ae"); // new rules really do route differently
    expect(explainLeadTool(db, fixedClock, { leadId })).toEqual(before);
    const hashes = db.prepare("SELECT config_hash FROM decisions ORDER BY id").all() as { config_hash: string }[];
    expect(hashes[0]!.config_hash).not.toBe(hashes[1]!.config_hash);
  });
  it("gives a clear not-found error for an unknown id, and still audits the call", () => {
    const { db } = makeApp();
    expect(() => explainLeadTool(db, fixedClock, { leadId: 999 })).toThrow(ToolError);
    expect(() => explainLeadTool(db, fixedClock, { leadId: 999 })).toThrow(/No lead with id 999/);
    expect(count(db, "audit_log")).toBe(2);
  });
  it("rejects non-positive and non-integer ids", () => {
    for (const leadId of [0, -1, 1.5, "1"]) expect(explainLeadInputSchema.safeParse({ leadId }).success).toBe(false);
  });
});

describe("list_leads", () => {
  const seed = async (n: number) => {
    const app = makeApp();
    for (let i = 0; i < n; i++) await app.post(validBody({ email: `lead${i}@orbitbank.example` }), { "idempotency-key": `k${i}` });
    return app;
  };
  it("masks emails and defaults to 10, newest first", async () => {
    const { db } = await seed(12);
    const [summary, json] = listLeadsTool(db, fixedClock, {});
    const rows = JSON.parse(json!);
    expect(rows).toHaveLength(10);
    expect(rows[0].leadId).toBe(12);
    expect(rows[0].email).toBe("l***@orbitbank.example");
    expect(summary + json).not.toContain("lead11@");
  });
  it("respects limit and the queue filter", async () => {
    const { db, post } = await seed(3);
    await post(validBody({ email: "sam@tinystudio.example", source: "webinar" }));
    expect(JSON.parse(listLeadsTool(db, fixedClock, { limit: 2 })[1]!)).toHaveLength(2);
    const smb = JSON.parse(listLeadsTool(db, fixedClock, { queue: "smb_nurture" })[1]!);
    expect(smb.map((r: any) => r.queue)).toEqual(["smb_nurture"]);
  });
  it("rejects a limit over 20", () => {
    expect(listLeadsInputSchema.safeParse({ limit: 21 }).success).toBe(false);
    expect(listLeadsInputSchema.safeParse({ limit: 20 }).success).toBe(true);
  });
  it("says so when empty", () => {
    const { db } = makeApp();
    expect(listLeadsTool(db, fixedClock, {})[0]).toBe("No leads found.");
  });
  it("audits tool calls without personal data", async () => {
    const { db } = await seed(2);
    listLeadsTool(db, fixedClock, {});
    explainLeadTool(db, fixedClock, { leadId: 1 });
    const rows = db.prepare("SELECT actor, action, detail_json FROM audit_log WHERE action = 'tool_call'").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor === "mcp")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("orbitbank");
  });
});
