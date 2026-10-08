# Roadmap

Phases are intentionally small: each one is a shippable slice, independently reviewable and testable.
Each phase gets a folder `specs/YYYY-MM-DD-<name>/` with `requirements.md`, `plan.md`, `validation.md`.

---

## Phase 1 - Hello MCP
- Scaffold TypeScript project (strict), Vitest, pinned deps
- MCP server over stdio with one `ping` tool
- Confirm Claude can connect and call it

## Phase 2 - Deliverability Auditor
- `audit_domain` tool: SPF, DMARC, DKIM (common selectors) via DNS
- Score 0-100 and prioritized fixes
- DNS behind an interface; unit tests with fake resolver

## Phase 3 - Lead Scoring and Routing
- Lead model, mock enrichment data
- Scoring and routing rules in a config file
- `route_lead` tool returning owner, score and the rules that fired

## Phase 4 - Webhook Intake and Mock CRM
- Hono `POST /webhooks/lead` with Zod validation and a shared-secret check
- SQLite tables: leads, decisions, audit_log
- `explain_lead` tool: why a lead was routed where it was (from the stored decision, never recomputed)
- `list_leads` tool (masked emails) so Claude can find ids to explain

## Phase 5 - AI SDR Drafter with Guardrails
- `draft_email` tool: Claude drafts from lead + approved-facts file
- Guardrails: unsubscribe line, suppression list, unapproved-claims check
- Approval queue; nothing is sent; `approve_draft` / `reject_draft` tools
- `estimate_cost_per_meeting` tool with documented assumptions

## Phase 6 - Docs and Demo
- README quickstart, architecture diagram, runbook, data rules
- Two-minute demo recording
- Short cover note for the Krisp team

---

## Replanning Log
_Add dated notes here when scope changes._

- 2026-10-08 (Phase 4): storage driver changed from `better-sqlite3` to built-in `node:sqlite` to avoid a native build on Node 25; engine floor raised to Node 22.5+. Added `list_leads` to Phase 4.
