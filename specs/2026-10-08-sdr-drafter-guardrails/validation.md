# Phase 5 Validation - AI SDR Drafter with Guardrails

Phase 5 is done when every box below is checked. Everything under Automated runs with no LM Studio, no API key and no network.

## Automated

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` passes with no LM Studio running and no network (`fetch` is stubbed in drafter tests)
- [ ] Config and data: valid files load; invalid ones fail naming the field path; duplicate fact ids and unknown queues are rejected
- [ ] Schema migrates v1 -> v2 in place and keeps leads, decisions and audit rows; running it twice changes nothing
- [ ] Draft immutability: changing subject, body, claims, guardrail report or content hash by `UPDATE` aborts; status moves only from `pending_review`

## Eligibility (no model call, no cost)

- [ ] `disqualify` and `needs_review` leads are skipped with a reason code and a `draft_skipped` audit row; the spy drafter was not called
- [ ] A suppressed email and a suppressed domain are each skipped, matched case-insensitively
- [ ] The fourth draft for one lead, and the 51st in 24 hours, are skipped
- [ ] The limit check holds when two drafts race for the last slot (checked inside the insert transaction)

## What the model sees

- [ ] Model input contains first name, title, company, queue and that queue's approved facts
- [ ] Model input contains **neither the email address nor the last name**
- [ ] A lead message with an instruction-like pattern is dropped from the model input and the report shows `lead_message_dropped`
- [ ] A long lead message is truncated to 500 characters
- [ ] The drafter is given no tools

## Guardrails (each has a passing and a failing test)

- [ ] `fact_ids_valid`: unknown id and id not allowed for the queue are blocked
- [ ] `min_claims`: a draft citing no fact is blocked
- [ ] `needs_source`: "SOC 2 certified" with no supporting cited fact is blocked, and passes when a cited fact contains the term; same for a number, a percentage and a superlative
- [ ] `never_claim`: "guarantee" and "as we discussed" are blocked
- [ ] `no_links_or_addresses`: a URL, an email address and a bare domain are blocked
- [ ] `length`: subject over 80 and body over 1200 characters are blocked
- [ ] `no_internal_ids`: a fact id like `F-1`, prompt wording and a `{{placeholder}}` in the body are blocked
- [ ] `footer`: the footer appears exactly once and was appended by code; a model-written fake footer is blocked
- [ ] The report always includes `notChecked`
- [ ] **Adversarial**: a drafter that follows an injection (adds a link and a discount) is blocked even when the sanitizer is bypassed

## Model result handling (local drafter, `fetch` stubbed)

- [ ] A valid reply is parsed and re-validated with Zod; a reply that violates the schema is blocked `invalid_model_output` even if the server claimed to enforce it
- [ ] `finish_reason: "length"` -> blocked `output_truncated`; empty or unparseable content -> blocked `invalid_model_output`
- [ ] A leading `<think>...</think>` block is stripped before parsing
- [ ] Connection refused gives a tool error that names LM Studio and the base URL, and stores nothing; a timeout and an HTTP 500 do the same
- [ ] A non-loopback base URL is refused unless `SDR_ALLOW_REMOTE_LLM=1`
- [ ] `SDR_DRAFTER=anthropic` fails with a clear "reserved for Phase 5c" message and does **not** fall back to another drafter
- [ ] Token usage, `drafter`, `model` and `est_cost_usd` (0 for local and template) are stored per draft, so a local draft can never be mistaken for a Claude one

## Approval queue

- [ ] `approve_draft` on a `blocked` draft is refused
- [ ] `approve_draft` with the wrong `reviewedHash` is refused and the draft stays `pending_review`
- [ ] A draft that is already approved or rejected cannot be approved or rejected again
- [ ] `approve_draft` and `reject_draft` call nothing external (no network, no send)
- [ ] `reject_draft` stores the note on the draft; the audit row holds only the reason code

## Audit and privacy

- [ ] Every outcome writes an audit row: `draft_created`, `draft_blocked`, `draft_skipped`, `draft_approved`, `draft_rejected`
- [ ] After a full scenario, no audit row contains a lead email, a name, a lead message or any draft text (test scans all rows)
- [ ] The audit append guard still rejects anything that looks like an email address

## Protocol

- [ ] `tools/list` shows the existing five tools plus `draft_email`, `get_draft`, `list_drafts`, `approve_draft`, `reject_draft`
- [ ] Nothing other than MCP messages is written to stdout of the MCP process

## Offline end to end (template drafter)

- [ ] Webhook-created leads drafted over stdio for each draftable queue; one suppressed lead and one `needs_review` lead are skipped; record the table here
- [ ] Draft -> `get_draft` -> `approve_draft` with the hash works; `reject_draft` works; audit log inspected for PII

## Local model check (free; needs LM Studio running)

- [ ] `SDR_DRAFTER=local` with `meta-llama-3.1-8b-instruct` on a handful of synthetic leads: record pass and block counts, which checks fired, tokens and latency here
- [ ] The same leads with `qwen/qwen3-14b`; record the comparison here. These numbers describe local models and must not be quoted as Claude's quality.
- [ ] One lead with an injection-style message: the message is dropped, and the draft contains no link or discount
- [ ] Asking Claude Code to draft for a lead, read it, and approve it with the hash produces the expected result

## Hygiene

- [ ] No new dependencies were added in this phase (`package.json` dependencies unchanged)
- [ ] `.env.example` lists `SDR_DRAFTER`, `SDR_LOCAL_BASE_URL`, `SDR_LOCAL_MODEL` and `SDR_ALLOW_REMOTE_LLM`, with no secrets
- [ ] `data/approved-facts.json` contains no statistics, customer names, certifications or pricing, and every fact is marked `pilot-placeholder`
- [ ] Sender identity, postal address and sender domain in `config/sdr.json` are visibly placeholders
- [ ] `tech-stack.md` and the `roadmap.md` Replanning Log reflect the Phase 5 / 5b / 5c split and the local-model decision
- [ ] `roadmap.md` Phase 5 is marked done
