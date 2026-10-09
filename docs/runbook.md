# Runbook

How to run, check, back up and troubleshoot GTM Copilot. Written for whoever operates the pilot, so the system does not depend on one person.

Every command below was run against a scratch database while writing this document. Run them from the repository root. The pilot uses synthetic data only; the "Known gaps" section lists what a production deployment would still need.

## At a glance

| Part | Started by | Listens on | State |
|---|---|---|---|
| MCP server | The MCP client (Claude Code) when a session starts | stdio, no port | none of its own |
| Webhook service | You: `npm run webhook` | `127.0.0.1:3000` (`HOST`, `PORT`) | none of its own |
| SQLite database | Created on first use | file `data/gtm.db` (`GTM_DB_PATH`) | **all data**: leads, decisions, drafts, audit log |

Both processes use the same database file. The default path is anchored to the repository, so they agree regardless of the directory they start from.

## Everyday operations

### Check that the webhook is up

There is no health endpoint (see Known gaps). An unauthenticated request is rejected quickly, which proves the service is answering:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3000/webhooks/lead
# 401 means up. Connection refused means down.
```

Check the MCP server with `claude mcp list` (it should show `gtm-copilot` connected) or by asking Claude to call `ping`.

### Start and stop

```bash
export WEBHOOK_SECRET=<16 or more characters>
npm run webhook          # stop with Ctrl-C
```

The service refuses to start with a missing or short secret and says why. The MCP server needs no manual start; a new Claude Code session starts it.

### Rotate the webhook secret

1. Generate a new secret: `openssl rand -hex 24`.
2. Stop the webhook, export the new `WEBHOOK_SECRET`, start it again.
3. Give the new secret to every sender.
4. Verify: the old secret returns `401`, the new one `200`, and previously stored leads are still there.

**There is no overlap window**: the old secret stops working the moment the service restarts, so coordinate with senders first. Rejected attempts appear in the audit log (query Q2) with the reason `invalid` or `missing`, never with the secret or the body.

### Back up and restore

A backup can be taken while the webhook is running:

```bash
sqlite3 data/gtm.db "VACUUM INTO 'backup.db'"
sqlite3 -cmd "PRAGMA query_only = ON;" backup.db "PRAGMA integrity_check;"    # expect: ok
```

The backup keeps the schema, including the triggers that make the audit log and drafts tamper-resistant. To restore, stop both processes, replace `data/gtm.db` with the backup (and delete any `data/gtm.db-wal` and `data/gtm.db-shm`), then start again. You can also point a server at a copy with `GTM_DB_PATH`.

A backup contains personal data. Treat it like the database (see [data-rules.md](data-rules.md)).

### Reset the demo data

Stop the webhook and end any Claude Code session using the server, then:

```bash
rm -f data/gtm.db data/gtm.db-wal data/gtm.db-shm
```

The next start creates an empty database at the current schema version. Reload demo leads with `./scripts/seed-demo-leads.sh`.

### Add an opt-out

Edit `data/suppression.json`:

```json
{ "type": "email", "value": "person@example.com", "reason": "asked to stop" }
{ "type": "domain", "value": "example.com", "reason": "company-wide opt-out" }
```

**It takes effect on the next `draft_email` call, with no restart**: the list is read on every draft, and a malformed file makes drafting fail closed instead of silently allowing everyone. Verify by asking Claude to draft for that lead; the result should say it is on the suppression list. Matching is case-insensitive.

### Change rules, facts or prompts

Scoring and routing (`config/routing.json`), draft limits and guardrail phrases (`config/sdr.json`), approved facts (`data/approved-facts.json`), the cost model and prompts are read once per process, so **a change needs a restart**: restart the webhook, and start a new Claude Code session for the MCP server. This is deliberate: rule changes should be intentional and reviewable.

1. Edit the file. A malformed file is rejected with the field path in the message (at startup for routing, on first use for the draft and cost settings).
2. Run `npm test`. Add a test for any new rule or pattern.
3. Record a prompt, rule or fact change in the replanning log in [`specs/roadmap.md`](../specs/roadmap.md).
4. Restart and verify. Every stored decision carries the hash of the rules that produced it, so the effect is visible (query Q7). Old decisions are never recomputed.

### Schema upgrades

The database upgrades itself on start (idempotent, data kept). A database written by a newer version is refused with "newer than this code" instead of being modified.

## Investigating

Open the database read-only. Use `PRAGMA query_only` rather than `-readonly`: SQLite's `-readonly` flag cannot open a database in WAL mode when no process has it open.

```bash
sqlite3 -cmd "PRAGMA query_only = ON;" -header -column data/gtm.db "<query>"
```

| # | Question | Query |
|---|---|---|
| Q1 | What happened most recently? | `SELECT id, ts, actor, action, lead_id FROM audit_log ORDER BY id DESC LIMIT 20;` |
| Q2 | Is the webhook being probed? | `SELECT action, json_extract(detail_json,'$.reason') AS reason, COUNT(*) AS n FROM audit_log WHERE action IN ('unauthorized','payload_rejected') AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') GROUP BY 1,2 ORDER BY n DESC;` |
| Q3 | Block rate by model and prompt | `SELECT model, prompt_version, COUNT(*) AS drafts, SUM(status='blocked') AS blocked, ROUND(100.0*SUM(status='blocked')/COUNT(*)) AS pct_blocked FROM drafts WHERE drafter != 'template' GROUP BY 1,2 ORDER BY 1,2;` |
| Q4 | Which guardrail checks fail most? | `SELECT j.value AS check_id, COUNT(*) AS n FROM audit_log a, json_each(a.detail_json,'$.failedChecks') j WHERE a.action='draft_blocked' GROUP BY 1 ORDER BY n DESC;` |
| Q5 | Why was drafting skipped? | `SELECT json_extract(detail_json,'$.reason') AS reason, COUNT(*) AS n FROM audit_log WHERE action='draft_skipped' GROUP BY 1 ORDER BY n DESC;` |
| Q6 | Which drafts did humans decide? | `SELECT ts, action, lead_id, json_extract(detail_json,'$.draftId') AS draft, json_extract(detail_json,'$.reasonCode') AS reason FROM audit_log WHERE action IN ('draft_approved','draft_rejected') ORDER BY id DESC;` |
| Q7 | Which rule set made each decision? | `SELECT substr(config_hash,1,12) AS config, COUNT(*) AS decisions, MIN(decided_at) AS first_seen FROM decisions GROUP BY 1;` |
| Q8 | One lead's complete history | `SELECT id, ts, actor, action, detail_json FROM audit_log WHERE lead_id = <id> ORDER BY id;` |
| Q9 | Is the database healthy? | `PRAGMA integrity_check; PRAGMA user_version;` (expect `ok` and the current version) |

To ask why a lead was routed, use `explain_lead` through Claude. It returns the decision as stored with its rule trace.

## Playbooks

### Deliverability dropped, or a sending domain looks wrong

1. Ask Claude: *audit the email authentication for `<sending domain>`*. If DKIM is expected, pass the sender's selector: *with DKIM selector `<name>`*. Selectors cannot be discovered from DNS, so without one a missing DKIM result only means "not found under the selectors tried".
2. Work through the findings from critical to info:

| Finding | Severity | What it means | Fix |
|---|---|---|---|
| No SPF record found | critical | Receivers cannot verify the sender | Publish one `v=spf1 include:<your sender> -all` TXT record |
| N SPF records found; receivers treat this as a permanent error | critical | Two SPF records invalidate each other | Merge into a single record |
| SPF ends with '+all' | critical | Authorizes every sender | Replace with `-all` or `~all` |
| SPF has N lookup mechanisms (limit is 10) | critical | Receivers stop evaluating past 10 lookups | Remove unused includes or flatten |
| SPF has no 'all' / ends with '?all' | warning | No protection | End with `~all`, then `-all` |
| SPF uses '~all' | info | Softfail | Move to `-all` once every sender is covered |
| No DMARC record found | critical | No policy and no reports | Publish `v=DMARC1; p=none; rua=mailto:...` and tighten over time |
| DMARC policy is 'none' | warning | Monitoring only | Move to `quarantine`, then `reject`, once reports are clean |
| No 'rua' reporting address | warning | You cannot see who sends as your domain | Add a reporting address |
| DMARC policy is 'quarantine' / applies to only N% | info | Partial enforcement | Move to `reject` and 100% when stable |
| No DKIM key found under the selectors tried | warning | Unknown selector, or DKIM not enabled | Get the selector from the sending platform and re-run with it |
| Could not check SPF / DMARC / DKIM | warning | The DNS lookup failed. This is **not** a pass or a fail and is excluded from the score | Re-run; if it persists, check DNS |

3. Re-run after each change. DNS changes can take time to propagate.
4. This tool reads authentication records only. It cannot see sender reputation, blocklists, complaint or bounce rates, inbox placement, warm-up state, message content, MTA-STS or BIMI. If authentication is clean and results are still poor, those are the next places to look, with separate tools.

### The webhook secret may have leaked, or rejections spiked

1. Run Q2. A burst of `unauthorized / invalid` means someone is guessing; `missing` means a sender is misconfigured.
2. If a leak is possible, rotate the secret now (see above) and check Q1 for unexpected `lead_received` entries from before the rotation.
3. Bodies and secrets are never logged, so the audit log shows that something happened, not what was sent. Look at the stored leads for the affected window.

### The draft block rate rose

1. Run Q3. Compare models and prompt versions. A jump on one model after a prompt change points at the prompt; a jump after switching models points at the model.
2. Run Q4 to see which checks fail. In the pilot's live runs, small local models failed mostly on `length`, `needs_source` and `no_internal_ids`.
3. **Do not loosen a guardrail to make numbers look better.** Fix the prompt or switch model; keep the old prompt version stored so the comparison stays valid.

### The model server is unreachable

`draft_email` returns an error naming LM Studio and its address, and **stores nothing**. Start the server (`lms server start`) and make sure a chat model is available (the first request after a cold start can take 20 seconds while the model loads). To work without a model, restart with `SDR_DRAFTER=template`. Nothing falls back silently, and every draft records which drafter wrote it.

### A prompt injection may have succeeded, or a new attack phrase appeared

1. Find the lead and its drafts (Q8). Check the draft report for `lead_message_dropped`, and read the draft text for links, promises or instructions.
2. If a malicious message was **not** dropped, add a pattern to `injectionPatterns` in `config/sdr.json` and a test for it in `src/sdr/sanitize.test.ts`, then restart.
3. If the draft itself contained something that should have been blocked, the gap is in a guardrail: add a test that reproduces it first, then fix the check. Two real gaps were found and fixed exactly this way.
4. Reject any affected draft with `reject_draft`.

### A wrong draft was approved

Approval is final and drafts are immutable, so it cannot be revoked inside this system, and **this system sends nothing**. Tell whoever owns the sending step not to send that draft. Record the incident outside the system. A production version needs a revoke state; see Known gaps.

### An opt-out or complaint arrived

Add the person or domain to `data/suppression.json` (immediate effect, see above), then check the history (Q8) for drafts already created and reject any still pending.

### A data-erasure request arrived

**Not supported in the pilot.** Drafts and the audit log are immutable by design, and there is no erasure path. For pilot data, which is synthetic, delete the database. See the erasure section of [data-rules.md](data-rules.md) for what a production design needs.

### Leads seem duplicated or missing

- Duplicates: a repeated delivery returns the original result with `duplicate: true` and creates nothing (audit action `duplicate_ignored`). Senders should use an opaque `Idempotency-Key`, not personal data.
- Missing: look for `payload_rejected` and `unauthorized` entries (Q2). A `400` lists the failing field names, never the values.

## Known gaps

These are limits of the pilot, stated so nobody assumes otherwise.

- No health endpoint, no alerting; the queries above must be run by a person.
- No overlap window when rotating the webhook secret; no webhook rate limiting or TLS (the service binds to loopback by default).
- The MCP server has no user identity: it cannot tell a person from Claude calling a tool. Approval relies on the exact-hash requirement and the MCP client's permission prompt. **Do not allowlist `approve_draft`.**
- No revoke state after approval, and no erasure path.
- Idempotency keys are sender-chosen strings that are stored; senders must not put personal data in them.
- Rules, facts and prompts reload only on restart (by design); only the suppression list is live.
