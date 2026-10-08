import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  title TEXT,
  source TEXT NOT NULL,
  message TEXT,
  domain TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
  decided_at TEXT NOT NULL,
  queue TEXT NOT NULL,
  score INTEGER NOT NULL,
  decision_json TEXT NOT NULL,
  config_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('webhook', 'mcp')),
  action TEXT NOT NULL,
  lead_id INTEGER,
  detail_json TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- v2: AI SDR drafts. Content is immutable; only the decision fields may change, and only once.
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'blocked', 'approved', 'rejected')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  guardrails_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  drafter TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  decided_at TEXT,
  decision_reason TEXT,
  decision_note TEXT
);

CREATE TRIGGER IF NOT EXISTS drafts_content_immutable BEFORE UPDATE ON drafts
WHEN NEW.lead_id IS NOT OLD.lead_id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.subject IS NOT OLD.subject OR NEW.body IS NOT OLD.body
  OR NEW.claims_json IS NOT OLD.claims_json OR NEW.guardrails_json IS NOT OLD.guardrails_json
  OR NEW.content_hash IS NOT OLD.content_hash OR NEW.drafter IS NOT OLD.drafter
  OR NEW.model IS NOT OLD.model OR NEW.prompt_version IS NOT OLD.prompt_version
  OR NEW.input_tokens IS NOT OLD.input_tokens OR NEW.output_tokens IS NOT OLD.output_tokens
  OR NEW.est_cost_usd IS NOT OLD.est_cost_usd
BEGIN SELECT RAISE(ABORT, 'draft content is immutable'); END;

CREATE TRIGGER IF NOT EXISTS drafts_status_transition BEFORE UPDATE OF status ON drafts
WHEN OLD.status != 'pending_review' OR NEW.status NOT IN ('approved', 'rejected')
BEGIN SELECT RAISE(ABORT, 'illegal draft status transition'); END;

CREATE TRIGGER IF NOT EXISTS drafts_decision_final BEFORE UPDATE ON drafts
WHEN OLD.status != 'pending_review'
  AND (NEW.decided_at IS NOT OLD.decided_at OR NEW.decision_reason IS NOT OLD.decision_reason OR NEW.decision_note IS NOT OLD.decision_note)
BEGIN SELECT RAISE(ABORT, 'draft decision is final'); END;

CREATE TRIGGER IF NOT EXISTS drafts_no_delete BEFORE DELETE ON drafts
BEGIN SELECT RAISE(ABORT, 'drafts cannot be deleted'); END;
`;

/** Idempotent. Throws if the file was written by a newer schema. */
export function applySchema(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version > SCHEMA_VERSION) {
    throw new Error(`Database schema v${row.user_version} is newer than this code (v${SCHEMA_VERSION}).`);
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
