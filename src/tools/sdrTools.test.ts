import { describe, expect, it } from "vitest";
import { createDraft } from "../sdr/service.js";
import { DISQUALIFIED, ENTERPRISE, makeSdr } from "../sdr/testing.js";
import {
  approveDraftInputSchema, approveDraftTool, draftEmailInputSchema, draftEmailTool, getDraftInputSchema, getDraftTool,
  listDraftsInputSchema, listDraftsTool, rejectDraftInputSchema, rejectDraftTool,
} from "./sdrTools.js";

describe("input schemas", () => {
  it("require positive integer ids", () => {
    for (const bad of [0, -1, 1.5, "1"]) {
      expect(draftEmailInputSchema.safeParse({ leadId: bad }).success).toBe(false);
      expect(getDraftInputSchema.safeParse({ draftId: bad }).success).toBe(false);
    }
  });
  it("cap list_drafts at 20 and restrict status", () => {
    expect(listDraftsInputSchema.safeParse({ limit: 21 }).success).toBe(false);
    expect(listDraftsInputSchema.safeParse({ limit: 20, status: "pending_review" }).success).toBe(true);
    expect(listDraftsInputSchema.safeParse({ status: "sent" }).success).toBe(false);
  });
  it("require a full 64-character hex reviewedHash to approve", () => {
    expect(approveDraftInputSchema.safeParse({ draftId: 1, reviewedHash: "abc" }).success).toBe(false);
    expect(approveDraftInputSchema.safeParse({ draftId: 1, reviewedHash: "z".repeat(64) }).success).toBe(false);
    expect(approveDraftInputSchema.safeParse({ draftId: 1, reviewedHash: "a".repeat(64) }).success).toBe(true);
  });
  it("restrict reject reasons to the enum and cap the note", () => {
    expect(rejectDraftInputSchema.safeParse({ draftId: 1, reasonCode: "because" }).success).toBe(false);
    expect(rejectDraftInputSchema.safeParse({ draftId: 1, reasonCode: "tone", note: "x".repeat(501) }).success).toBe(false);
    expect(rejectDraftInputSchema.safeParse({ draftId: 1, reasonCode: "tone", note: "ok" }).success).toBe(true);
  });
});

describe("tool handlers", () => {
  it("draft_email returns the draft, the guardrail report and how to approve it", async () => {
    const s = makeSdr();
    const [text, json] = await draftEmailTool(s.deps, { leadId: await s.seed(ENTERPRISE) });
    const body = JSON.parse(json!);
    expect(text).toMatch(/pending_review/);
    expect(text).toContain(`approve_draft { draftId: ${body.draftId}, reviewedHash: "${body.contentHash}" }`);
    expect(text).toContain("Nothing is sent");
    expect(text).toMatch(/Not checked by code/);
    expect(body.claimsUsed[0]).toMatchObject({ id: "F-NC-01" });
    expect(body.claimsUsed[0].text).toMatch(/noise cancellation/);
    expect(body.guardrails.status).toBe("passed");
    expect(JSON.stringify(body)).not.toMatch(/vp@orbitbank|Vance/);
  });

  it("draft_email reports a skip as a normal result, not an error", async () => {
    const s = makeSdr();
    const [text, json] = await draftEmailTool(s.deps, { leadId: await s.seed(DISQUALIFIED) });
    expect(text).toMatch(/No draft created/);
    expect(text).toMatch(/Nothing was sent to the model/);
    expect(JSON.parse(json!)).toMatchObject({ skipped: true, reason: "queue_not_draftable" });
  });

  it("get_draft returns the stored draft, errors on unknown ids, and audits the call", async () => {
    const s = makeSdr();
    const out = await createDraft(s.deps, await s.seed(ENTERPRISE));
    if (out.kind !== "drafted") throw new Error("expected a draft");
    const [, json] = getDraftTool(s.deps, { draftId: out.draft.id });
    expect(JSON.parse(json!).contentHash).toBe(out.draft.contentHash);
    expect(() => getDraftTool(s.deps, { draftId: 99 })).toThrow(/No draft with id 99/);
    const rows = s.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'tool_call'").all() as { detail_json: string }[];
    expect(rows.map((r) => JSON.parse(r.detail_json).tool)).toEqual(["get_draft", "get_draft"]);
  });

  it("list_drafts returns summaries without bodies, filters by status, and names failed checks", async () => {
    const s = makeSdr();
    const lead = await s.seed(ENTERPRISE);
    await createDraft(s.deps, lead);
    const [text, json] = listDraftsTool(s.deps, {});
    const rows = JSON.parse(json!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("body");
    expect(text).toMatch(/#1 lead #\d+ pending_review \[scripted\]/);
    expect(JSON.parse(listDraftsTool(s.deps, { status: "approved" })[1]!)).toEqual([]);
    expect(listDraftsTool(s.deps, { status: "approved" })[0]).toBe("No drafts found.");
  });

  it("approve_draft and reject_draft report the new state", async () => {
    const s = makeSdr();
    const lead = await s.seed(ENTERPRISE);
    const a = await createDraft(s.deps, lead);
    const b = await createDraft(s.deps, lead);
    if (a.kind !== "drafted" || b.kind !== "drafted") throw new Error("expected drafts");
    expect(approveDraftTool(s.deps, { draftId: a.draft.id, reviewedHash: a.draft.contentHash })[0]).toMatch(/approved.*nothing was sent/i);
    expect(rejectDraftTool(s.deps, { draftId: b.draft.id, reasonCode: "off_message" })[0]).toMatch(/rejected \(off_message\)/);
  });
});
