import { createHash } from "node:crypto";
import type { LeadDecision } from "../leads/index.js";
import type { Queue } from "../leads/config.js";
import type { Lead } from "../leads/model.js";
import type { Db } from "./open.js";

export interface StoredDecision {
  leadId: number;
  receivedAt: string;
  decidedAt: string;
  configHash: string;
  queue: Queue;
  score: number;
  decision: LeadDecision;
}

export interface LeadRow {
  leadId: number;
  receivedAt: string;
  email: string;
  domain: string;
  queue: Queue;
  score: number;
}

export function hashLead(lead: Lead): string {
  const canonical = [lead.email.toLowerCase(), lead.firstName, lead.lastName, lead.title ?? null, lead.source, lead.message ?? null];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface SaveArgs {
  lead: Lead;
  decision: LeadDecision;
  idempotencyKey: string;
  configHash: string;
  now: string;
}

/** Inserts the lead and its decision. Call inside `transaction` so they commit together. */
export function saveLeadWithDecision(db: Db, a: SaveArgs): number {
  const res = db
    .prepare(
      `INSERT INTO leads (received_at, email, first_name, last_name, title, source, message, domain, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.now, a.lead.email.toLowerCase(), a.lead.firstName, a.lead.lastName, a.lead.title ?? null, a.lead.source,
      a.lead.message ?? null, a.decision.domain, a.idempotencyKey);
  const leadId = Number(res.lastInsertRowid);
  db.prepare(
    "INSERT INTO decisions (lead_id, decided_at, queue, score, decision_json, config_hash) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(leadId, a.now, a.decision.route.queue, a.decision.score, JSON.stringify(a.decision), a.configHash);
  return leadId;
}

export function findLeadIdByKey(db: Db, key: string): number | null {
  const row = db.prepare("SELECT id FROM leads WHERE idempotency_key = ?").get(key) as { id: number } | undefined;
  return row ? row.id : null;
}

export function getStoredDecision(db: Db, leadId: number): StoredDecision | null {
  const row = db
    .prepare(
      `SELECT l.id, l.received_at, d.decided_at, d.config_hash, d.queue, d.score, d.decision_json
       FROM leads l JOIN decisions d ON d.lead_id = l.id WHERE l.id = ?`,
    )
    .get(leadId) as
    | { id: number; received_at: string; decided_at: string; config_hash: string; queue: Queue; score: number; decision_json: string }
    | undefined;
  if (!row) return null;
  return {
    leadId: row.id,
    receivedAt: row.received_at,
    decidedAt: row.decided_at,
    configHash: row.config_hash,
    queue: row.queue,
    score: row.score,
    decision: JSON.parse(row.decision_json) as LeadDecision,
  };
}

export function listLeadRows(db: Db, opts: { queue?: Queue; limit: number }): LeadRow[] {
  const where = opts.queue ? "WHERE d.queue = ?" : "";
  const params = opts.queue ? [opts.queue, opts.limit] : [opts.limit];
  const rows = db
    .prepare(
      `SELECT l.id, l.received_at, l.email, l.domain, d.queue, d.score
       FROM leads l JOIN decisions d ON d.lead_id = l.id ${where} ORDER BY l.id DESC LIMIT ?`,
    )
    .all(...params) as { id: number; received_at: string; email: string; domain: string; queue: Queue; score: number }[];
  return rows.map((r) => ({ leadId: r.id, receivedAt: r.received_at, email: r.email, domain: r.domain, queue: r.queue, score: r.score }));
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export interface LeadRecord {
  id: number;
  receivedAt: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  source: string;
  message: string | null;
  domain: string;
}

export function getLead(db: Db, leadId: number): LeadRecord | null {
  const r = db
    .prepare("SELECT id, received_at, email, first_name, last_name, title, source, message, domain FROM leads WHERE id = ?")
    .get(leadId) as
    | { id: number; received_at: string; email: string; first_name: string; last_name: string; title: string | null; source: string; message: string | null; domain: string }
    | undefined;
  return r
    ? { id: r.id, receivedAt: r.received_at, email: r.email, firstName: r.first_name, lastName: r.last_name, title: r.title, source: r.source, message: r.message, domain: r.domain }
    : null;
}
