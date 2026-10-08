import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { appendAudit, systemClock, type AuditAction, type Clock } from "../db/audit.js";
import { findLeadIdByKey, getStoredDecision, hashLead, saveLeadWithDecision } from "../db/leads.js";
import { transaction, type Db } from "../db/open.js";
import { hashConfig, type RoutingConfig } from "../leads/config.js";
import type { Enricher } from "../leads/enrich.js";
import { processLead } from "../leads/index.js";
import { leadInputSchema } from "../leads/model.js";
import { secretMatches } from "./auth.js";

export const MAX_BODY_BYTES = 16 * 1024;

export interface WebhookDeps {
  db: Db;
  enricher: Enricher;
  config: RoutingConfig;
  secret: string;
  clock?: Clock;
}

export function createWebhookApp(deps: WebhookDeps): Hono {
  const { db, enricher, config, secret } = deps;
  const clock = deps.clock ?? systemClock;
  const configHash = hashConfig(config);
  const audit = (action: AuditAction, detail: Record<string, unknown>, leadId?: number) =>
    appendAudit(db, clock, { actor: "webhook", action, detail, leadId });

  const app = new Hono();

  // Order matters: authenticate before reading any body.
  app.use("/webhooks/lead", async (c, next) => {
    const provided = c.req.header("x-webhook-secret");
    if (!secretMatches(provided, secret)) {
      audit("unauthorized", { reason: provided === undefined ? "missing" : "invalid" });
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.use(
    "/webhooks/lead",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => {
        audit("payload_rejected", { reason: "payload_too_large" });
        return c.json({ error: "payload_too_large" }, 413);
      },
    }),
  );

  app.post("/webhooks/lead", async (c) => {
    const reject = (status: 400 | 415, error: string, extra: Record<string, unknown> = {}) => {
      audit("payload_rejected", { reason: error, ...(extra.fields ? { fields: extra.fields } : {}) });
      return c.json({ error, ...extra }, status);
    };

    if (!/^application\/json\b/i.test(c.req.header("content-type") ?? "")) {
      return reject(415, "unsupported_media_type");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await c.req.text());
    } catch {
      return reject(400, "invalid_json");
    }

    const parsed = leadInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return reject(400, "invalid_payload", { issues, fields: [...new Set(issues.map((i) => i.path))] });
    }
    const lead = parsed.data;

    const header = c.req.header("idempotency-key");
    if (header !== undefined && !/^[\x21-\x7e]{1,200}$/.test(header)) {
      return reject(400, "invalid_idempotency_key");
    }
    const key = header !== undefined ? `hdr:${header}` : `body:${hashLead(lead)}`;

    const decision = await processLead(lead, enricher, config);
    const now = clock().toISOString();

    const result = transaction(db, () => {
      const existing = findLeadIdByKey(db, key);
      if (existing !== null) {
        const stored = getStoredDecision(db, existing)!;
        audit("duplicate_ignored", { queue: stored.queue }, existing);
        return { leadId: existing, queue: stored.queue, score: stored.score, duplicate: true };
      }
      const leadId = saveLeadWithDecision(db, { lead, decision, idempotencyKey: key, configHash, now });
      audit("lead_received", { domain: decision.domain, source: lead.source }, leadId);
      audit("lead_routed", { queue: decision.route.queue, score: decision.score, ruleId: decision.route.ruleId, configHash }, leadId);
      return { leadId, queue: decision.route.queue, score: decision.score, duplicate: false };
    });

    return c.json(result, 200);
  });

  app.onError((err, c) => {
    console.error("webhook error:", err instanceof Error ? err.message : "unknown");
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
