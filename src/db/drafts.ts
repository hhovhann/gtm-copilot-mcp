import type { GuardrailReport } from "../sdr/guardrails.js";
import type { Db } from "./open.js";

export type DraftStatus = "pending_review" | "blocked" | "approved" | "rejected";

export interface DraftRow {
  id: number;
  leadId: number;
  createdAt: string;
  status: DraftStatus;
  subject: string;
  body: string;
  claims: string[];
  guardrails: GuardrailReport;
  contentHash: string;
  drafter: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  decidedAt: string | null;
  decisionReason: string | null;
  decisionNote: string | null;
}

export type NewDraft = Omit<DraftRow, "id" | "decidedAt" | "decisionReason" | "decisionNote">;

interface Raw {
  id: number; lead_id: number; created_at: string; status: DraftStatus; subject: string; body: string;
  claims_json: string; guardrails_json: string; content_hash: string; drafter: string; model: string;
  prompt_version: string; input_tokens: number; output_tokens: number; est_cost_usd: number;
  decided_at: string | null; decision_reason: string | null; decision_note: string | null;
}

const toRow = (r: Raw): DraftRow => ({
  id: r.id, leadId: r.lead_id, createdAt: r.created_at, status: r.status, subject: r.subject, body: r.body,
  claims: JSON.parse(r.claims_json) as string[], guardrails: JSON.parse(r.guardrails_json) as GuardrailReport,
  contentHash: r.content_hash, drafter: r.drafter, model: r.model, promptVersion: r.prompt_version,
  inputTokens: r.input_tokens, outputTokens: r.output_tokens, estCostUsd: r.est_cost_usd,
  decidedAt: r.decided_at, decisionReason: r.decision_reason, decisionNote: r.decision_note,
});

export function insertDraft(db: Db, d: NewDraft): number {
  const res = db
    .prepare(
      `INSERT INTO drafts (lead_id, created_at, status, subject, body, claims_json, guardrails_json, content_hash,
         drafter, model, prompt_version, input_tokens, output_tokens, est_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(d.leadId, d.createdAt, d.status, d.subject, d.body, JSON.stringify(d.claims), JSON.stringify(d.guardrails),
      d.contentHash, d.drafter, d.model, d.promptVersion, d.inputTokens, d.outputTokens, d.estCostUsd);
  return Number(res.lastInsertRowid);
}

export function getDraft(db: Db, id: number): DraftRow | null {
  const r = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as Raw | undefined;
  return r ? toRow(r) : null;
}

export function listDrafts(db: Db, opts: { status?: DraftStatus; limit: number }): DraftRow[] {
  const where = opts.status ? "WHERE status = ?" : "";
  const params = opts.status ? [opts.status, opts.limit] : [opts.limit];
  return (db.prepare(`SELECT * FROM drafts ${where} ORDER BY id DESC LIMIT ?`).all(...params) as unknown as Raw[]).map(toRow);
}

export function countDraftsForLead(db: Db, leadId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE lead_id = ?").get(leadId) as { n: number }).n;
}

export function countDraftsSince(db: Db, sinceIso: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE created_at >= ?").get(sinceIso) as { n: number }).n;
}

/** The schema triggers enforce that this is only legal from pending_review. */
export function decideDraft(
  db: Db,
  id: number,
  d: { status: "approved" | "rejected"; decidedAt: string; reason?: string; note?: string },
): void {
  db.prepare("UPDATE drafts SET status = ?, decided_at = ?, decision_reason = ?, decision_note = ? WHERE id = ?").run(
    d.status, d.decidedAt, d.reason ?? null, d.note ?? null, id,
  );
}
