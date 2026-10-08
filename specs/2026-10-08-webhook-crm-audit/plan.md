# Phase 4 Plan - Webhook Intake, Mock CRM and Audit Log

## Group 0 - Constitution Update (on approval of the SQLite decision)

1. Update `specs/tech-stack.md`: storage is `node:sqlite`, engine floor Node 22.5+; set `engines` in `package.json` to match
2. Add a dated entry to the Replanning Log in `specs/roadmap.md`, and add `list_leads` to the Phase 4 bullets

## Group 1 - Database

3. `src/db/open.ts`: open the file (or `:memory:` for tests), enable WAL and foreign keys, run the schema
4. `src/db/schema.ts`: idempotent `CREATE TABLE IF NOT EXISTS` for the three tables, `user_version` check, and the `BEFORE UPDATE` / `BEFORE DELETE` abort triggers on `audit_log`
5. `src/db/audit.ts`: `appendAudit(db, { actor, action, leadId?, detail })` with a clock dependency
6. `src/db/leads.ts`: `saveLeadWithDecision` in one transaction; `findByIdempotencyKey`; `getDecision`; `listLeads`
7. Tests: schema is idempotent; audit `UPDATE` and `DELETE` both fail; a failed decision insert rolls back the lead; `.gitignore` covers `data/*.db*`. WAL is verified live on the real file, since tests use only in-memory databases

## Group 2 - Webhook

8. `src/webhook/auth.ts`: constant-time secret compare (hash both sides, then `timingSafeEqual`) and the startup secret check
9. `src/webhook/app.ts`: Hono app factory taking `{ db, enricher, config, secret, clock }`; middleware order is auth, body limit, content type, validation, idempotency, process (auth first so an unauthenticated caller never gets a body read)
10. Idempotency key from header or SHA-256 of the normalized body; duplicate path writes `duplicate_ignored` and returns the stored result
11. Audit entries for every outcome, with no payload and no PII
12. `src/webhook.ts`: entry point; reads env, fails fast on a bad secret, binds to `127.0.0.1`
13. Tests with `app.request()` and an in-memory DB: 401 (missing, wrong), 415, 413, 400 (field paths, no echoed values), 200 success, duplicate delivery, audit row per outcome

## Group 3 - MCP Tools

14. `src/tools/explainLead.ts` and `src/tools/listLeads.ts` with Zod inputs; email masking helper
15. Register both in `src/server.ts`; the server opens the DB from `GTM_DB_PATH` unless one is injected; each call appends a `tool_call` audit row
16. Tests: explain returns the stored decision; **explain is unchanged after the routing config changes**; unknown id gives a not-found error; list masks emails, respects limit and queue filter, rejects limit over 20

## Group 4 - Verify

17. `npm run typecheck` and `npm test`
18. End to end on a real file DB: start `src/webhook.ts`, `curl` one lead per route with the secret, repeat one for the duplicate case, send one with a bad secret
19. Over stdio against the same DB file: `list_leads`, then `explain_lead` on a webhook-created lead; inspect `audit_log` with `sqlite3` or a script and confirm no PII
20. Call from Claude Code: "show me the latest leads and explain the enterprise one"; record results in `validation.md`
21. Mark Phase 4 done in `roadmap.md`
