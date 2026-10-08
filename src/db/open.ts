import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.js";

export type Db = DatabaseSync;

/** Anchored to the repo, not the working directory, so the webhook and MCP processes agree. */
export function defaultDbPath(): string {
  return fileURLToPath(new URL("../../data/gtm.db", import.meta.url));
}

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["GTM_DB_PATH"] || defaultDbPath();
}

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  applySchema(db);
  return db;
}

/** Runs fn in a write transaction; rolls back if it throws. Not re-entrant. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
