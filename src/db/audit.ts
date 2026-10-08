import type { Db } from "./open.js";

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export type AuditAction =
  | "lead_received"
  | "lead_routed"
  | "duplicate_ignored"
  | "payload_rejected"
  | "unauthorized"
  | "tool_call"
  | "draft_created"
  | "draft_blocked"
  | "draft_skipped"
  | "draft_approved"
  | "draft_rejected";

export interface AuditEntry {
  actor: "webhook" | "mcp";
  action: AuditAction;
  leadId?: number | null;
  detail?: Record<string, unknown>;
}

const LOOKS_LIKE_EMAIL = /[^\s"@]+@[^\s"@]+/;

/** Append-only. Detail must carry no personal data: ids, domains, queues, scores, field paths. */
export function appendAudit(db: Db, clock: Clock, entry: AuditEntry): void {
  const detail = JSON.stringify(entry.detail ?? {});
  if (LOOKS_LIKE_EMAIL.test(detail)) {
    throw new Error("Refusing to write an audit entry that looks like it contains an email address.");
  }
  db.prepare("INSERT INTO audit_log (ts, actor, action, lead_id, detail_json) VALUES (?, ?, ?, ?, ?)").run(
    clock().toISOString(),
    entry.actor,
    entry.action,
    entry.leadId ?? null,
    detail,
  );
}
