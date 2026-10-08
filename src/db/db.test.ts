import { describe, expect, it } from "vitest";
import { appendAudit } from "./audit.js";
import { openDb, transaction } from "./open.js";
import { applySchema, SCHEMA_VERSION } from "./schema.js";
import { saveLeadWithDecision } from "./leads.js";
import { fixedClock, count } from "./testing.js";
import { processLead } from "../leads/index.js";
import { lead, realConfig, realEnricher } from "../leads/testing.js";

describe("schema", () => {
  it("is idempotent and sets user_version", () => {
    const db = openDb(":memory:");
    applySchema(db);
    applySchema(db);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    expect(count(db, "leads")).toBe(0);
  });
  it("refuses a database from a newer schema", () => {
    const db = openDb(":memory:");
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => applySchema(db)).toThrow(/newer/);
  });
});

describe("audit_log", () => {
  const seeded = () => {
    const db = openDb(":memory:");
    appendAudit(db, fixedClock, { actor: "webhook", action: "unauthorized", detail: { reason: "missing" } });
    return db;
  };
  it("rejects UPDATE", () => {
    expect(() => seeded().exec("UPDATE audit_log SET action = 'x'")).toThrow(/append-only/);
  });
  it("rejects DELETE", () => {
    expect(() => seeded().exec("DELETE FROM audit_log")).toThrow(/append-only/);
  });
  it("refuses a detail that looks like it holds an email", () => {
    const db = openDb(":memory:");
    expect(() => appendAudit(db, fixedClock, { actor: "mcp", action: "tool_call", detail: { who: "jane@acme.com" } })).toThrow(/email/);
    expect(count(db, "audit_log")).toBe(0);
  });
});

describe("transaction", () => {
  it("rolls back the lead when the decision insert fails", async () => {
    const db = openDb(":memory:");
    const l = lead({ email: "vp@orbitbank.example" });
    const good = await processLead(l, realEnricher(), realConfig());
    const broken = { ...good, route: { ...good.route, queue: null } } as unknown as typeof good;
    expect(() =>
      transaction(db, () => saveLeadWithDecision(db, { lead: l, decision: broken, idempotencyKey: "k", configHash: "h", now: "t" })),
    ).toThrow();
    expect(count(db, "leads")).toBe(0);
    expect(count(db, "decisions")).toBe(0);
  });
});
