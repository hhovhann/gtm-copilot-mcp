import { describe, expect, it } from "vitest";
import { decideDraft, getDraft, insertDraft, countDraftsForLead, countDraftsSince, type NewDraft } from "./drafts.js";
import { openDb } from "./open.js";
import { applySchema, SCHEMA_VERSION } from "./schema.js";
import { auditActions, count, makeApp } from "./testing.js";

const report = { status: "passed" as const, checks: [], notChecked: [] };
const draft = (leadId: number, over: Partial<NewDraft> = {}): NewDraft => ({
  leadId, createdAt: "2026-10-08T12:00:00.000Z", status: "pending_review", subject: "s", body: "b", claims: ["F-NC-01"],
  guardrails: report, contentHash: "h".repeat(64), drafter: "scripted", model: "m", promptVersion: "p", inputTokens: 10, outputTokens: 5, estCostUsd: 0, ...over,
});

async function withLead() {
  const app = makeApp();
  const res = await app.post({ email: "vp@orbitbank.example", firstName: "Vera", lastName: "Vance", source: "demo_request" });
  return { db: app.db, leadId: ((await res.json()) as { leadId: number }).leadId };
}

describe("schema v2", () => {
  it("is version 2 and migrates a v1 database in place, keeping data", async () => {
    expect(SCHEMA_VERSION).toBe(2);
    const { db } = await withLead();
    db.exec("DROP TABLE drafts");
    db.exec("PRAGMA user_version = 1");
    const before = [count(db, "leads"), count(db, "decisions"), count(db, "audit_log")];
    applySchema(db);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
    expect(count(db, "drafts")).toBe(0);
    expect([count(db, "leads"), count(db, "decisions"), count(db, "audit_log")]).toEqual(before);
    applySchema(db); // idempotent
    expect(count(db, "drafts")).toBe(0);
  });
});

describe("drafts table", () => {
  it("stores and reads back a draft", async () => {
    const { db, leadId } = await withLead();
    const id = insertDraft(db, draft(leadId));
    expect(getDraft(db, id)).toMatchObject({ leadId, status: "pending_review", claims: ["F-NC-01"], inputTokens: 10, decidedAt: null });
  });

  it.each([
    ["subject", "UPDATE drafts SET subject = 'x'"],
    ["body", "UPDATE drafts SET body = 'x'"],
    ["claims", "UPDATE drafts SET claims_json = '[]'"],
    ["guardrail report", "UPDATE drafts SET guardrails_json = '{}'"],
    ["content hash", "UPDATE drafts SET content_hash = 'x'"],
    ["model", "UPDATE drafts SET model = 'x'"],
    ["token counts", "UPDATE drafts SET input_tokens = 0"],
    ["lead id", "UPDATE drafts SET lead_id = 999"],
  ])("aborts an UPDATE of the %s", async (_n, sql) => {
    const { db, leadId } = await withLead();
    insertDraft(db, draft(leadId));
    expect(() => db.exec(sql)).toThrow(/immutable/);
  });

  it("allows pending_review -> approved or rejected, once", async () => {
    const { db, leadId } = await withLead();
    const a = insertDraft(db, draft(leadId));
    decideDraft(db, a, { status: "approved", decidedAt: "t" });
    expect(getDraft(db, a)).toMatchObject({ status: "approved", decidedAt: "t" });
    expect(() => decideDraft(db, a, { status: "rejected", decidedAt: "t2" })).toThrow(/illegal draft status transition|decision is final/);
    const r = insertDraft(db, draft(leadId));
    decideDraft(db, r, { status: "rejected", decidedAt: "t", reason: "tone", note: "too pushy" });
    expect(getDraft(db, r)).toMatchObject({ status: "rejected", decisionReason: "tone", decisionNote: "too pushy" });
  });

  it("makes a decision final: the note and reason cannot be rewritten afterwards", async () => {
    const { db, leadId } = await withLead();
    const id = insertDraft(db, draft(leadId));
    decideDraft(db, id, { status: "rejected", decidedAt: "t", reason: "tone", note: "original" });
    expect(() => db.exec(`UPDATE drafts SET decision_note = 'rewritten' WHERE id = ${id}`)).toThrow(/final/);
    expect(() => db.exec(`UPDATE drafts SET decided_at = 'later' WHERE id = ${id}`)).toThrow(/final/);
    expect(getDraft(db, id)!.decisionNote).toBe("original");
  });

  it("never lets a blocked draft change status, and forbids other transitions and deletes", async () => {
    const { db, leadId } = await withLead();
    const b = insertDraft(db, draft(leadId, { status: "blocked" }));
    expect(() => decideDraft(db, b, { status: "approved", decidedAt: "t" })).toThrow(/illegal|final/);
    const p = insertDraft(db, draft(leadId));
    expect(() => db.exec(`UPDATE drafts SET status = 'blocked' WHERE id = ${p}`)).toThrow(/illegal|final/);
    expect(() => db.exec("DELETE FROM drafts")).toThrow(/cannot be deleted/);
  });

  it("counts drafts per lead and since a time", async () => {
    const { db, leadId } = await withLead();
    insertDraft(db, draft(leadId, { createdAt: "2026-10-07T00:00:00.000Z" }));
    insertDraft(db, draft(leadId, { createdAt: "2026-10-08T12:00:00.000Z" }));
    expect(countDraftsForLead(db, leadId)).toBe(2);
    expect(countDraftsSince(db, "2026-10-08T00:00:00.000Z")).toBe(1);
  });

  it("does not disturb the audit log append-only triggers", async () => {
    const { db } = await withLead();
    expect(auditActions(db).length).toBeGreaterThan(0);
    expect(() => db.exec("DELETE FROM audit_log")).toThrow(/append-only/);
  });
});

describe("a fresh database", () => {
  it("has the drafts table", () => {
    expect(count(openDb(":memory:"), "drafts")).toBe(0);
  });
});
