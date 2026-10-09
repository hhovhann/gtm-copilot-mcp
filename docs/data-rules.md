# Data rules

What data the system holds, where it goes, who can see it, and what is still missing. Written so that Security and Legal can review it without reading the code.

**Status of this document:** the pilot uses **synthetic data only**. Anything marked *proposed* is a recommendation for a real deployment and is not implemented. Nothing here is legal advice; retention periods, lawful basis and outreach rules vary by jurisdiction and need review by Legal.

## Principles

1. **Minimize.** Collect only what routing and drafting need. The model never receives an email address or last name.
2. **Keep personal data out of logs.** The audit log holds ids, queues, check ids and counts, and refuses to store anything that looks like an email address.
3. **Keep it local.** The drafting model runs on loopback by default; a remote model needs an explicit opt-in.
4. **Make decisions reproducible.** Each decision is stored as made, with the hash of the rules that produced it. History is never recomputed.
5. **Make tampering visible.** Audit entries and drafts are immutable; the database refuses edits.
6. **Nothing is sent.** There is no email transport in the system.

## What is stored

| Where | Fields | Personal data? | Why it exists |
|---|---|---|---|
| `leads` | email (lowercased), first name, last name, title, message, source, domain, idempotency key | **Yes**: direct identifiers and free text | The CRM record |
| `decisions` | queue, score, rule trace, enrichment used, rules hash | Low: company facts and matched keywords, no email or name | Explainable routing |
| `drafts` | subject, body, cited fact ids, guardrail report, hash, drafter, model, tokens, decision and note | **Yes**: the body can contain the first name and company; the reject note is free text | The approval queue |
| `audit_log` | timestamp, actor, action, lead id, small detail record | **No**, enforced by a guard in code | Accountability |
| `data/approved-facts.json` | Statements the model may use | No | Controlled messaging |
| `data/suppression.json` | Emails and domains never to draft for, with a reason | **Yes** (emails) | Honoring opt-outs |
| `data/companies.json` | Mock enrichment | No (synthetic) | Stand-in for a data provider |
| Logs (stdout, stderr) | A startup line; error messages without bodies | No | Operation |

Two details worth knowing:

- The message a lead typed is stored as received. It is free text and could contain anything the sender chose to write, so treat the `message` and the reject `note` columns as the least predictable data in the system.
- The idempotency key is chosen by the sender and stored. Senders must use opaque identifiers, not email addresses.

## Where data goes

| Flow | What leaves | Where to | Notes |
|---|---|---|---|
| Senders to the webhook | The lead JSON | This service, loopback by default | Secret required; size, type and schema checked |
| The service to the database | Everything above | A local SQLite file | Access is controlled by file permissions; backups contain personal data |
| Drafting prompt to the model | First name, title, company name, industry, size band, lead source, team label, the approved facts, and the lead's message **only if it passed the injection filter** (at most 500 characters) | The local model on loopback | **Never** the email address, last name or any other lead |
| Tool results to Claude | Whatever a tool returns | The model provider behind the MCP client | See below |
| Domain audits | The domain being audited | The system's DNS resolver | Reveals which domains you audit; public records only |

**Anything an MCP tool returns is sent to the model provider that runs the MCP client.** That is why the tools return the minimum: `list_leads` masks emails (`v***@domain`), `explain_lead` and `route_lead` return the company, domain and rule trace but never the email or name, and `get_draft` returns the draft text, which contains the first name and company. If a tool's output must not reach that provider, do not expose the tool.

A future Claude drafter (Phase 5c) would send the same minimized prompt to the Anthropic API instead of to a local model. That changes the data flow and needs the same review before it is switched on.

## Who can see what

- **The MCP server has no user identity or access control.** Whoever can start it through an MCP client can call every tool. Treat access to the MCP client as access to the data.
- **The database file is readable by anyone with file access.** Restrict it with operating system permissions.
- **The webhook accepts anyone who holds the shared secret.** Rotate it when people or systems change (see the [runbook](runbook.md)).
- **Approval is a human decision**, but the server cannot verify that a human made it. See the runbook's known gaps.

## Governing the content that controls behavior

| Content | Controls | Rule |
|---|---|---|
| **Approved facts** (`data/approved-facts.json`) | The only product statements the model may use | Marketing and Legal approve each fact before its status changes from `pilot-placeholder` to `approved`. No statistics, customer names, certifications or prices unless a source is recorded. A test enforces that pilot facts contain no digits |
| **Suppression list** (`data/suppression.json`) | Who is never drafted for | Anyone may add an entry; **removing one needs a recorded reason**. Additions take effect immediately; a malformed file blocks drafting |
| **Routing and scoring rules** (`config/routing.json`) | Where leads go | Changes are tested, noted in the replanning log in `specs/roadmap.md`, and visible afterwards through the rules hash on every decision |
| **Guardrail phrases and injection patterns** (`config/sdr.json`) | What drafts may contain | Add patterns with a regression test. **Never loosen a guardrail to improve a block rate** |
| **Cost assumptions** (`config/economics.json`) | The cost-per-meeting comparison | Every number is a labeled placeholder until replaced with real data; the tool tags each input as measured, assumption or override |

These are **governance rules for people**. Code enforces only a few of them: the shape of each file is validated, the suppression list is re-read on every draft, pilot facts are tested to contain no digits, and every rule change is covered by tests. Who may approve a fact, who may remove a suppression entry and why, are policy and need an owner.

## Retention and erasure

**Implemented:** nothing is deleted automatically, and drafts and audit entries cannot be deleted by design. The pilot's data is synthetic, so the way to clear it is to delete the database file (see the runbook).

**Not implemented, and required before real use:**

- **A retention period** *(proposed)*: delete or anonymize leads that never became customers after a fixed period set by Legal, for example 12 months, and keep the audit log (which holds no personal data) longer.
- **An erasure path** *(proposed)*: the immutability triggers deliberately block deletion, so erasing one person needs a **controlled, audited exception**: a routine that replaces that person's fields in `leads` with a tombstone, replaces the matching `drafts` subject and body with a marker, records an `erased` audit entry holding only ids and a hash, and runs only in a maintenance window with the triggers re-created afterwards. Because drafts embed the first name, a cleaner design stores personal fields separately from immutable content, or encrypts them per lead so that deleting the key erases them.
- **An access request path** *(proposed)*: export everything stored for one email address (`leads`, the matching `drafts`, and the audit entries that reference the lead).

## Outreach compliance

The code enforces a few things; **it does not decide whether outreach is lawful**.

- Enforced: an opt-out line and sender address block are appended to every draft by code (the model cannot write or remove them); suppressed contacts are never drafted for; nothing is sent.
- **Placeholders that must change before real use:** the sender name, the postal address and the sender domain in `config/sdr.json` are visibly fake.
- **Needs Legal:** the lawful basis for contacting each lead, regional rules for business email (these differ), how opt-outs are honored across systems, and how long suppression entries are kept.

## Review checklist before any real deployment

- [ ] Legal has reviewed lawful basis, retention and the erasure design
- [ ] Security has reviewed access (MCP client, database file, webhook secret) and the data flows above
- [ ] Real approved facts replace the pilot placeholders, each with a recorded source
- [ ] Sender identity, postal address and domain are real, and the domain passes the deliverability audit
- [ ] Webhook uses the sender's signature scheme, rate limiting and TLS
- [ ] An erasure path, a revoke state for approvals, health checks and alerting exist
- [ ] If a hosted model is used, its data handling terms have been reviewed against the flows above
