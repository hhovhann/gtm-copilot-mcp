import { z } from "zod";
import { appendAudit, type Clock } from "../db/audit.js";
import { getDraft, listDrafts, type DraftRow, type DraftStatus } from "../db/drafts.js";
import type { Db } from "../db/open.js";
import { approveDraft, createDraft, rejectDraft, REJECT_REASONS, type SdrDeps } from "../sdr/service.js";
import { ToolError } from "./errors.js";

const id = z.number().int().positive();
const STATUSES = ["pending_review", "blocked", "approved", "rejected"] as const;

export const draftEmailInputSchema = z.object({ leadId: id });
export const getDraftInputSchema = z.object({ draftId: id });
export const listDraftsInputSchema = z.object({ status: z.enum(STATUSES).optional(), limit: z.number().int().min(1).max(20).optional() });
export const approveDraftInputSchema = z.object({ draftId: id, reviewedHash: z.string().length(64).regex(/^[0-9a-f]+$/) });
export const rejectDraftInputSchema = z.object({ draftId: id, reasonCode: z.enum(REJECT_REASONS), note: z.string().max(500).optional() });

function factText(deps: Pick<SdrDeps, "facts">, ids: string[]) {
  return ids.map((fid) => ({ id: fid, text: deps.facts.find((f) => f.id === fid)?.text ?? "(unknown fact id)" }));
}

function view(deps: Pick<SdrDeps, "facts">, d: DraftRow) {
  return {
    draftId: d.id, leadId: d.leadId, status: d.status, createdAt: d.createdAt, decidedAt: d.decidedAt,
    subject: d.subject, body: d.body, claimsUsed: factText(deps, d.claims), guardrails: d.guardrails,
    contentHash: d.contentHash, drafter: d.drafter, model: d.model, promptVersion: d.promptVersion,
    usage: { inputTokens: d.inputTokens, outputTokens: d.outputTokens },
  };
}

function summary(d: DraftRow): string {
  const failed = d.guardrails.checks.filter((c) => c.status === "fail");
  const warned = d.guardrails.checks.filter((c) => c.status === "warn");
  const lines = [`Draft #${d.id} for lead #${d.leadId}: ${d.status} (drafter ${d.drafter}, model ${d.model})`];
  if (d.subject || d.body) lines.push(`Subject: ${d.subject}`, "", d.body, "");
  lines.push(`Guardrails: ${d.guardrails.status} (${d.guardrails.checks.length} checks)`);
  for (const c of failed) lines.push(`  FAIL ${c.id}: ${c.detail}`);
  for (const c of warned) lines.push(`  warn ${c.id}: ${c.detail}`);
  lines.push(`Not checked by code (needs your eyes): ${d.guardrails.notChecked.join("; ")}`);
  if (d.status === "pending_review") lines.push(`To approve: approve_draft { draftId: ${d.id}, reviewedHash: "${d.contentHash}" }. Nothing is sent.`);
  return lines.join("\n");
}

const toolCall = (db: Db, clock: Clock, tool: string, extra: Record<string, unknown> = {}, leadId?: number) =>
  appendAudit(db, clock, { actor: "mcp", action: "tool_call", leadId, detail: { tool, ...extra } });

export async function draftEmailTool(deps: SdrDeps, input: z.infer<typeof draftEmailInputSchema>): Promise<string[]> {
  const out = await createDraft(deps, input.leadId);
  if (out.kind === "skipped") {
    const text = `No draft created for lead #${input.leadId}: ${out.message}. Nothing was sent to the model.`;
    return [text, JSON.stringify({ skipped: true, reason: out.reason, leadId: input.leadId })];
  }
  return [summary(out.draft), JSON.stringify(view(deps, out.draft), null, 2)];
}

export function getDraftTool(deps: SdrDeps, input: z.infer<typeof getDraftInputSchema>): string[] {
  const d = getDraft(deps.db, input.draftId);
  toolCall(deps.db, deps.clock, "get_draft", { draftId: input.draftId, found: d !== null }, d?.leadId);
  if (!d) throw new ToolError(`No draft with id ${input.draftId}. Use list_drafts to find ids.`);
  return [summary(d), JSON.stringify(view(deps, d), null, 2)];
}

export function listDraftsTool(deps: SdrDeps, input: z.infer<typeof listDraftsInputSchema>): string[] {
  const limit = input.limit ?? 10;
  const rows = listDrafts(deps.db, { status: input.status as DraftStatus | undefined, limit }).map((d) => ({
    draftId: d.id, leadId: d.leadId, status: d.status, subject: d.subject, drafter: d.drafter, model: d.model, createdAt: d.createdAt,
    failedChecks: d.guardrails.checks.filter((c) => c.status === "fail").map((c) => c.id),
  }));
  toolCall(deps.db, deps.clock, "list_drafts", { status: input.status ?? null, limit, returned: rows.length });
  const text = rows.length
    ? rows.map((r) => `#${r.draftId} lead #${r.leadId} ${r.status} [${r.drafter}] ${r.subject || "(no content)"}${r.failedChecks.length ? ` -- failed: ${r.failedChecks.join(", ")}` : ""}`).join("\n")
    : "No drafts found.";
  return [text, JSON.stringify(rows, null, 2)];
}

export function approveDraftTool(deps: SdrDeps, input: z.infer<typeof approveDraftInputSchema>): string[] {
  const d = approveDraft(deps, input.draftId, input.reviewedHash);
  return [`Draft #${d.id} approved at ${d.decidedAt}. It is marked ready for the sending step; nothing was sent.`, JSON.stringify(view(deps, d), null, 2)];
}

export function rejectDraftTool(deps: SdrDeps, input: z.infer<typeof rejectDraftInputSchema>): string[] {
  const d = rejectDraft(deps, input.draftId, input.reasonCode, input.note);
  return [`Draft #${d.id} rejected (${input.reasonCode}).`, JSON.stringify(view(deps, d), null, 2)];
}
