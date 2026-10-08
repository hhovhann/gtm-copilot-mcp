import { createHash } from "node:crypto";
import { appendAudit, type Clock } from "../db/audit.js";
import { countDraftsForLead, countDraftsSince, decideDraft, getDraft, insertDraft, type DraftRow } from "../db/drafts.js";
import { getLead, getStoredDecision } from "../db/leads.js";
import { transaction, type Db } from "../db/open.js";
import { ToolError } from "../tools/errors.js";
import { factsForQueue, isSuppressed, type Fact, type SdrConfig, type SuppressionEntry } from "./config.js";
import type { Drafter, DrafterFailureCode } from "./drafter.js";
import { appendFooter } from "./footer.js";
import { NOT_CHECKED, runGuardrails, type GuardrailReport } from "./guardrails.js";
import { buildPrompt, PROMPT_VERSION, sizeBand } from "./prompt.js";
import { sanitizeLead } from "./sanitize.js";

export interface SdrDeps {
  db: Db;
  clock: Clock;
  drafter: Drafter;
  facts: Fact[];
  suppression: SuppressionEntry[];
  config: SdrConfig;
}

export type SkipReason = "queue_not_draftable" | "suppressed" | "lead_limit" | "daily_limit" | "no_facts";

export const SKIP_MESSAGES: Record<SkipReason, string> = {
  queue_not_draftable: "this lead's queue is not eligible for drafting (disqualified or needs a human review first)",
  suppressed: "the lead or its domain is on the suppression list",
  lead_limit: "the per-lead draft limit has been reached",
  daily_limit: "the 24-hour draft limit has been reached",
  no_facts: "there are no approved facts for this lead's queue",
};

export type CreateOutcome =
  | { kind: "skipped"; reason: SkipReason; message: string }
  | { kind: "drafted"; draft: DraftRow };

const FAILURE_DETAIL: Record<DrafterFailureCode, string> = {
  model_refusal: "the model refused to write this email",
  output_truncated: "the model ran out of tokens before finishing",
  invalid_model_output: "the model's reply was empty or did not match the required shape",
};

const hashDraft = (subject: string, body: string, claims: string[]) =>
  createHash("sha256").update(JSON.stringify([subject, body, claims])).digest("hex");

function limitReason(deps: SdrDeps, leadId: number): SkipReason | null {
  const since = new Date(deps.clock().getTime() - 24 * 3600 * 1000).toISOString();
  if (countDraftsForLead(deps.db, leadId) >= deps.config.limits.maxDraftsPerLead) return "lead_limit";
  if (countDraftsSince(deps.db, since) >= deps.config.limits.maxDraftsPer24h) return "daily_limit";
  return null;
}

export async function createDraft(deps: SdrDeps, leadId: number): Promise<CreateOutcome> {
  const { db, clock, config } = deps;
  const lead = getLead(db, leadId);
  const stored = getStoredDecision(db, leadId);
  if (!lead || !stored) throw new ToolError(`No lead with id ${leadId}. Use list_leads to find ids.`);
  const queue = stored.queue;

  const skip = (reason: SkipReason): CreateOutcome => {
    appendAudit(db, clock, { actor: "mcp", action: "draft_skipped", leadId, detail: { reason, queue } });
    return { kind: "skipped", reason, message: SKIP_MESSAGES[reason] };
  };

  // Everything below happens before any model call, so a denied lead costs nothing.
  if (!config.draftableQueues.includes(queue)) return skip("queue_not_draftable");
  if (isSuppressed(deps.suppression, lead.email, lead.domain)) return skip("suppressed");
  const early = limitReason(deps, leadId);
  if (early) return skip(early);
  const queueFacts = factsForQueue(deps.facts, queue);
  if (queueFacts.length === 0) return skip("no_facts");

  const clean = sanitizeLead(lead, config);
  const enrichment = stored.decision.enrichment;
  const company = enrichment.status === "found" ? enrichment.company : undefined;
  const prompt = buildPrompt({
    firstName: clean.firstName,
    title: clean.title,
    companyName: company?.name,
    industry: company?.industry,
    sizeBand: company ? sizeBand(company.employees) : undefined,
    queue,
    queueLabel: stored.decision.route.label,
    source: lead.source,
    facts: queueFacts,
    message: clean.message,
  });

  // The model call is deliberately outside any database transaction.
  const result = await deps.drafter.draft({
    prompt,
    context: { firstName: clean.firstName, companyName: company?.name, queue, facts: queueFacts },
  });

  let subject = "";
  let body = "";
  let claims: string[] = [];
  let report: GuardrailReport;
  if (result.ok) {
    subject = result.draft.subject;
    claims = result.draft.claimsUsed;
    body = appendFooter(result.draft.body, config);
    report = runGuardrails(
      {
        subject,
        body: result.draft.body,
        finalBody: body,
        claimsUsed: claims,
        queue,
        allowedLiterals: [company?.name ?? "", clean.title ?? "", clean.firstName],
        flags: clean.flags,
      },
      deps.facts,
      config,
    );
  } else {
    report = {
      status: "blocked",
      checks: [
        { id: result.code, status: "fail", detail: FAILURE_DETAIL[result.code] },
        ...clean.flags.map((f) => ({ id: f, status: "warn" as const, detail: "input was sanitized before the model call" })),
      ],
      notChecked: NOT_CHECKED,
    };
  }

  const status = report.status === "passed" ? "pending_review" : "blocked";
  const outcome = transaction(db, (): CreateOutcome => {
    const late = limitReason(deps, leadId); // re-check: another draft may have taken the last slot
    if (late) return skip(late);
    const id = insertDraft(db, {
      leadId,
      createdAt: clock().toISOString(),
      status,
      subject,
      body,
      claims,
      guardrails: report,
      contentHash: hashDraft(subject, body, claims),
      drafter: result.drafter,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estCostUsd: 0,
    });
    appendAudit(db, clock, {
      actor: "mcp",
      action: status === "blocked" ? "draft_blocked" : "draft_created",
      leadId,
      detail: {
        draftId: id, queue, drafter: result.drafter, model: result.model, promptVersion: PROMPT_VERSION,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        ...(status === "blocked" ? { failedChecks: report.checks.filter((c) => c.status === "fail").map((c) => c.id) } : {}),
      },
    });
    return { kind: "drafted", draft: getDraft(db, id)! };
  });
  return outcome;
}

function mustGet(db: Db, draftId: number): DraftRow {
  const d = getDraft(db, draftId);
  if (!d) throw new ToolError(`No draft with id ${draftId}. Use list_drafts to find ids.`);
  return d;
}

export function approveDraft(deps: Pick<SdrDeps, "db" | "clock">, draftId: number, reviewedHash: string): DraftRow {
  const { db, clock } = deps;
  return transaction(db, () => {
    const d = mustGet(db, draftId);
    if (d.status === "blocked") throw new ToolError(`Draft ${draftId} was blocked by the guardrails and cannot be approved. Draft a new one.`);
    if (d.status !== "pending_review") throw new ToolError(`Draft ${draftId} is already ${d.status}.`);
    if (reviewedHash !== d.contentHash) {
      throw new ToolError(`reviewedHash does not match draft ${draftId}. Call get_draft, read the exact content, and pass its contentHash.`);
    }
    decideDraft(db, draftId, { status: "approved", decidedAt: clock().toISOString() });
    appendAudit(db, clock, { actor: "mcp", action: "draft_approved", leadId: d.leadId, detail: { draftId, drafter: d.drafter, model: d.model } });
    return mustGet(db, draftId);
  });
}

export const REJECT_REASONS = ["off_message", "inaccurate", "tone", "wrong_lead", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export function rejectDraft(deps: Pick<SdrDeps, "db" | "clock">, draftId: number, reason: RejectReason, note?: string): DraftRow {
  const { db, clock } = deps;
  return transaction(db, () => {
    const d = mustGet(db, draftId);
    if (d.status !== "pending_review") throw new ToolError(`Draft ${draftId} is ${d.status}; only pending drafts can be rejected.`);
    decideDraft(db, draftId, { status: "rejected", decidedAt: clock().toISOString(), reason, note });
    // The free-text note stays on the draft. The audit log only gets the reason code.
    appendAudit(db, clock, { actor: "mcp", action: "draft_rejected", leadId: d.leadId, detail: { draftId, reasonCode: reason } });
    return mustGet(db, draftId);
  });
}
