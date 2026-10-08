# Phase 4 Validation - Webhook Intake, Mock CRM and Audit Log

Phase 4 is done when every box below is checked.

## Automated

- [x] `npm run typecheck` exits 0
- [x] `npm test` passes using only in-memory databases and `app.request()`; no network port is opened
- [x] Schema setup is idempotent; running it twice changes nothing
- [x] `audit_log` rejects `UPDATE` and `DELETE` (trigger abort), and the tests prove it
- [x] Saving a lead and its decision is atomic (a forced failure leaves no orphan lead)

## Webhook behavior

- [x] Missing secret -> 401; wrong secret -> 401; neither stores a lead
- [x] Non-JSON content type -> 415; body over 16 KB -> 413
- [x] Invalid payload -> 400 listing field paths, and the response contains none of the submitted values
- [x] Valid lead -> 200 with `leadId`, `queue`, `score`, `duplicate: false`; one `leads`, one `decisions`, and `lead_received` plus `lead_routed` audit rows exist
- [x] Same delivery again -> 200, same `leadId`, `duplicate: true`; still one lead and one decision; `duplicate_ignored` logged
- [x] Same body with a different `Idempotency-Key` is treated as a new delivery; same key with the same body is a duplicate
- [x] Startup fails with a clear message when `WEBHOOK_SECRET` is unset or under 16 characters
- [x] Default bind address is `127.0.0.1`

## Audit and privacy

- [x] Every webhook outcome is audited: 401, 400, 413, 415 and duplicates add one row each; a new lead adds two (`lead_received`, `lead_routed`)
- [x] No `detail_json` in any audit row contains an email address, a name or a message body (test scans rows after a full scenario)
- [x] Request bodies are never written to stdout or stderr

## MCP tools

- [x] `tools/list` shows `ping`, `audit_domain`, `route_lead`, `explain_lead` and `list_leads`
- [x] `explain_lead` returns the stored breakdown, route trace, config hash and timestamps
- [x] After the routing config is changed, `explain_lead` for an old lead is **unchanged**
- [x] `explain_lead` with an unknown id returns a clear not-found error, not a crash
- [x] `list_leads` masks emails, defaults to 10, rejects `limit` over 20, and filters by queue
- [x] Each `explain_lead` and `list_leads` call adds a `tool_call` audit row with no PII
- [x] Nothing other than MCP messages is written to stdout of the MCP process

## Live end to end

- [x] Webhook process and MCP process share one SQLite file (checked with a scratch `GTM_DB_PATH`; `PRAGMA journal_mode` is `wal`); a lead posted by `curl` is visible to `list_leads` immediately
- [x] One lead per route posted by `curl`, then explained through MCP; record the table here

  | Lead (synthetic) | HTTP | leadId | Queue | Score |
  |---|---|---|---|---|
  | x@mailinator.com | 200 | 1 | disqualify | 0 |
  | CTO @ devtools-inc.example, "SDK" | 200 | 2 | developer_sdk | 80 |
  | Dir. Ops @ megacontact.example | 200 | 3 | call_center_specialist | 95 |
  | VP Ops @ orbitbank.example | 200 | 4 | enterprise_ae | 95 |
  | Manager @ brightpath.example | 200 | 5 | midmarket_ae | 35 |
  | @ tinystudio.example, webinar | 200 | 6 | smb_nurture | 8 |
  | @ unknownco.example, pricing + pilot | 200 | 7 | needs_review | 30 |
  | orbitbank lead again | 200 | 4 (`duplicate: true`) | enterprise_ae | 95 |
  | wrong secret / no secret | 401 | - | - | - |
  | invalid payload / text/plain / 20 KB body | 400 / 415 / 413 | - | - | - |

  Audit log after the run: 24 rows, no `@`, no names, no submitted marker strings; `DELETE FROM audit_log` aborts on the real file. Webhook log contains only the startup line.
- [x] Duplicate and bad-secret requests behave as above against the real process
- [ ] Asking Claude Code to list the latest leads and explain the enterprise one produces an answer that matches the stored breakdown

## Hygiene

- [x] `data/*.db`, `data/*.db-wal` and `data/*.db-shm` are git-ignored
- [x] `.env.example` lists `WEBHOOK_SECRET`, `GTM_DB_PATH`, `HOST` and `PORT` with no real secret
- [x] New dependencies (Hono, `@hono/node-server`) are pinned with no `^` or `~`
- [x] `tech-stack.md` and the `roadmap.md` Replanning Log reflect the SQLite decision
- [ ] `roadmap.md` Phase 4 is marked done
