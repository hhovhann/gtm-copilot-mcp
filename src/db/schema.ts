import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 1;

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
