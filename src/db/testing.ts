import { createWebhookApp } from "../webhook/app.js";
import type { RoutingConfig } from "../leads/config.js";
import { realConfig, realEnricher } from "../leads/testing.js";
import type { Enricher } from "../leads/enrich.js";
import { openDb, type Db } from "./open.js";

export const SECRET = "test-secret-0123456789abcdef";
export const fixedClock = () => new Date("2026-10-08T12:00:00.000Z");

export const validBody = (over: Record<string, unknown> = {}) => ({
  email: "vp@orbitbank.example",
  firstName: "Vera",
  lastName: "Vance",
  title: "VP Operations",
  source: "demo_request",
  ...over,
});

export function makeApp(opts: { db?: Db; config?: RoutingConfig; enricher?: Enricher } = {}) {
  const db = opts.db ?? openDb(":memory:");
  const app = createWebhookApp({
    db,
    enricher: opts.enricher ?? realEnricher(),
    config: opts.config ?? realConfig(),
    secret: SECRET,
    clock: fixedClock,
  });
  const post = (body: unknown, headers: Record<string, string> = {}, raw = false) =>
    app.request("/webhooks/lead", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET, ...headers },
      body: raw ? (body as string) : JSON.stringify(body),
    });
  return { app, db, post };
}

export const count = (db: Db, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

export const auditActions = (db: Db): string[] =>
  (db.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);
