# Phase 4 Requirements - Webhook Intake, Mock CRM and Audit Log

## Goal

Make the pipeline real end to end: a lead arrives by webhook, is routed with the Phase 3 engine, is stored in a SQLite stand-in CRM,
and every step is written to an append-only audit log. Then RevOps can ask Claude "why did this lead go there?" **days later** and get the
decision as it was made, not a recomputation. This is the "monitored, reliable automation" and "safe, auditable access" slice.

## Scope

### Webhook (Hono) - `POST /webhooks/lead`

- Runs as its own process (`src/webhook.ts`), separate from the MCP stdio server. Both open the same SQLite file.
- Auth: shared secret in the `X-Webhook-Secret` header, compared in constant time. Missing or wrong -> `401`, nothing stored except an audit entry (no payload).
- The process refuses to start if `WEBHOOK_SECRET` is unset or shorter than 16 characters.
- Body must be `application/json` (else `415`), at most 16 KB (else `413`), and valid per the Phase 3 `leadInputSchema` (else `400` with field paths, never echoing values).
- Idempotency: key is the `Idempotency-Key` header if present, otherwise a SHA-256 of the normalized body. A repeated delivery returns `200` with the original result and `duplicate: true`; no second lead or decision is created.
- Success -> `200 { leadId, queue, score, duplicate }`. Processing is synchronous; the engine is fast and deterministic.
- Binds to `127.0.0.1` by default (`HOST`, `PORT` env override).

### SQLite stand-in CRM

- Tables: `leads`, `decisions`, `audit_log`, created idempotently at startup; schema version tracked with `PRAGMA user_version`.
- `leads`: id, received_at, email, first_name, last_name, title, source, message, domain, idempotency_key (unique)
- `decisions`: id, lead_id, decided_at, queue, score, `decision_json` (the full Phase 3 `LeadDecision`), `config_hash` (SHA-256 of the routing config used)
- `audit_log`: id, ts, actor (`webhook` or `mcp`), action, lead_id (nullable), `detail_json`
  - Actions: `lead_received`, `lead_routed`, `duplicate_ignored`, `payload_rejected`, `unauthorized`, `tool_call`
  - **Append-only, enforced by SQLite triggers** that abort any `UPDATE` or `DELETE`
  - **No PII in `detail_json`**: lead id, domain, queue, score, error field paths and tool names only
- Database path from `GTM_DB_PATH`, default `data/gtm.db` (git-ignored); WAL mode so the two processes can share the file

### MCP tools (added to the existing server)

- `explain_lead`: input `leadId`; returns the **stored** decision (score breakdown, route trace, config hash, timestamps). It never recomputes. Unknown id -> a clear "not found" tool error.
- `list_leads`: optional `queue` filter and `limit` (default 10, max 20); returns id, received time, domain, queue, score, with the email masked (`j***@domain`). This is how Claude finds ids to explain.
- Every call to either tool writes a `tool_call` audit entry (tool name and lead id only)

## Out of Scope

- Real HubSpot/Salesforce signature schemes (HubSpot v3 HMAC), retries and queues, rate limiting, TLS
- Authentication on the MCP side (the stdio server trusts its local launcher)
- Deleting or exporting leads (GDPR erasure belongs in the Phase 6 data rules as a documented gap)
- Re-routing a stored lead under new rules, dashboards, multi-user access

## Context

- The webhook is the only untrusted network entry point in the project. Treat every field as hostile: validate, size-limit, never log payload bodies.
- Audit log rows must be useful to an investigator without containing the lead's personal data; the lead id links to the CRM table for those who are allowed to look.
- Because rules can change, `decision_json` plus `config_hash` is what makes an explanation trustworthy over time.
- All demo leads are synthetic.

## Decisions to confirm

1. **SQLite driver: `node:sqlite` (recommended) instead of `better-sqlite3`.** It is built into Node, so there is no native build step, which matters on Node 25. Costs: it prints an experimental warning on stderr, and the engine floor rises to Node 22.5+. `better-sqlite3` was not tried on this machine. On approval, update `tech-stack.md` and add a replanning-log entry in `roadmap.md`.
2. **Two processes sharing one SQLite file**, because an MCP stdio server cannot also host an HTTP port reliably.
3. **`list_leads` is an addition** to the original roadmap line, because `explain_lead` is unusable without a way to find ids.
4. **Shared secret rather than HMAC signatures**, as the roadmap says; HMAC is listed as the production upgrade.

## Layout

`src/db/{open,schema,leads,audit}.ts`, `src/webhook/{app,auth}.ts`, `src/webhook.ts` (entry), `src/tools/{explainLead,listLeads}.ts`
