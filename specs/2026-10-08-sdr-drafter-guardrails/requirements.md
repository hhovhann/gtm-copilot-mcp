# Phase 5 Requirements - AI SDR Drafter with Guardrails

## Goal

A `draft_email` MCP tool that has an LLM write a first outreach email for a routed lead, **using only approved facts**, then runs
deterministic guardrails on the result and puts it in a human approval queue. Nothing is ever sent.
The point of the phase is the judgment, not the prose: **the model proposes, code checks, a human decides.**
Every control that matters is enforced in code, so a manipulated or sloppy model cannot talk its way past it.

**For now the model is a local one** (LM Studio on this machine), used for experimenting at zero cost and with no lead data leaving the machine.
`claude-sonnet-5-5` stays the production target. The drafter sits behind an interface, so moving to Claude is a small, separate step (Phase 5c).
Local models are less reliable than Claude, which makes the guardrails matter more. Results here must never be presented as Claude's quality.

## Scope

### Trust model (who is allowed to do what)

| Actor | May | May not |
|---|---|---|
| Model | write a subject and body from the facts it is given; name the fact ids it used | add a footer, include links or addresses, state anything outside the cited facts, take any action |
| Code | choose which facts and lead fields the model sees, append the legal footer, run every guardrail, store the draft | trust the model's own claim that it complied |
| Human | approve or reject a draft that passed the guardrails | approve a draft that was blocked, or one whose content changed after review |

### Eligibility (checked **before** any model call, so a denied lead costs nothing)

- Only queues listed in `config/sdr.json` `draftableQueues` (default: `enterprise_ae`, `midmarket_ae`, `call_center_specialist`, `developer_sdk`, `smb_nurture`)
  can be drafted. `disqualify` and `needs_review` are skipped with a stated reason.
- **Suppression list** (`data/suppression.json`: emails and domains, each with a reason): a match on lead email or domain, case-insensitive, skips drafting.
- **Cost guards**: at most 3 drafts per lead and 50 drafts per rolling 24 hours (both in config). Checked inside the insert transaction.
- Skips are audited (`draft_skipped`, with a reason code) and returned to Claude as a clear tool result, not an error.

### What the model sees (data minimization)

- Allowed: first name, title, company name, industry, size band, queue, lead source, the **approved facts for that queue**, and, if it passes the sanitizer, the lead's message
- Never: email address, last name, other leads, anything from the audit log
- The lead's `message` is **untrusted text**. It is truncated to 500 characters, wrapped in a delimited block labeled untrusted,
  and **dropped entirely** if it matches an instruction-like pattern (`ignore previous`, `system prompt`, `you are now`, and similar, listed in config).
  The drop is recorded in the guardrail report as `lead_message_dropped`. This is defense in depth: guardrails below still run on whatever the model returns.
- The model has **no tools**. Its only output is a structured object, so a manipulated model cannot do anything except produce text that the guardrails then judge.

### Approved facts (`data/approved-facts.json`)

- Each fact: `id`, `text`, `category`, `allowedQueues`, `source`, `status`
- The pilot file contains **descriptive statements only** (what a product is for), paraphrased from public product names. **No statistics, customer names, certifications or pricing.**
  `status` is `pilot-placeholder`: real Marketing-approved messaging replaces it before any real use.
- The model must return the ids it used (`claimsUsed`); ids must exist and be allowed for the lead's queue

### Draft generation

- Structured output requested via the OpenAI-compatible `response_format` (`json_schema`, strict) with this shape: `subject` (max 80), `body` (max 1200), `claimsUsed` (1 to 5 fact ids), `cta` (`book_call` | `reply_question` | `share_resource`)
- **The server's schema enforcement is never trusted**: the reply is parsed and validated again with Zod
- Failures are handled explicitly and recorded as `blocked` drafts or clear tool errors; there is no automatic retry in this phase:
  - `finish_reason: "length"` -> blocked `output_truncated`
  - empty, unparseable or schema-invalid output -> blocked `invalid_model_output`
  - the model server not running (connection refused) or a timeout -> tool error naming LM Studio and the base URL, nothing stored
  - a leading `<think>...</think>` block (reasoning models such as Qwen3) is stripped before parsing
- Model, base URL, temperature, timeout and `max_tokens` come from `config/sdr.json`. Prompt text is versioned (`PROMPT_VERSION`) and stored with each draft.
- Drafters behind one `Drafter` interface:

| `SDR_DRAFTER` | What it is | Status |
|---|---|---|
| `local` (default) | LM Studio's OpenAI-compatible endpoint, called with `fetch`; default model `meta-llama-3.1-8b-instruct`, also tested with `qwen/qwen3-14b`; base URL `http://127.0.0.1:1234/v1` | built in this phase |
| `template` | deterministic, offline, labeled `template-v1`, no model | built in this phase |
| `anthropic` | `claude-sonnet-5-5` through the Anthropic SDK | **reserved for Phase 5c**; selecting it now fails with a clear "not built yet" message |
| scripted fake | canned outputs, tests only | built in this phase |

- Nothing falls back silently: if the chosen drafter cannot run, the tool says so
- **Loopback only**: the local base URL must be `127.0.0.1`, `localhost` or `::1`. Any other host is refused unless `SDR_ALLOW_REMOTE_LLM=1` is set, so lead data cannot be sent to a remote server by a typo
- **Token accounting**: tokens come from the server's `usage`; local cost is `$0`, stored as `est_cost_usd = 0`. Phase 5b prices these tokens at the production model's rates and labels the result a projection (local tokenizers differ from Claude's, so it is approximate).

### Guardrails (pure functions, no LLM, run on every draft)

| Check id | Rule | On failure |
|---|---|---|
| `fact_ids_valid` | every id in `claimsUsed` exists and is allowed for the queue | blocked |
| `min_claims` | at least one approved fact cited | blocked |
| `needs_source` | any number, `%`, currency amount, certification or compliance term (SOC 2, ISO 27001, HIPAA, GDPR, PCI), or superlative ("best", "#1", "only", "leading") in the body must also appear in a **cited** fact's text | blocked |
| `never_claim` | phrases from config such as "guarantee", "100%", "no risk", "as we discussed", "following our call" (invented history) | blocked |
| `no_links_or_addresses` | no URL, email address or domain-like token in subject or body | blocked |
| `no_internal_ids` | no fact id (like `F-1`), prompt wording or template placeholder (`{{...}}`) leaks into the subject or body | blocked |
| `length` | subject and body within limits | blocked |
| `footer` | the code-appended footer (unsubscribe line and sender address placeholder) is present exactly once and the model text did not impersonate one | blocked |
| `lead_message_dropped` | informational: the lead message was withheld from the model | warning |

- Report lists every check with `pass`, `fail` or `warn`, **and a `notChecked` list** stating what the guardrails cannot judge: paraphrased claims that evade the patterns, tone, spam-trigger wording, deliverability content scoring, and **role confusion** (a small model writing "our team" as if it worked at the lead's company). This is why human approval stays mandatory.

### Approval queue

- New table `drafts`: id, lead_id, created_at, status (`pending_review` | `blocked` | `approved` | `rejected`), subject, body (including footer), `claims_json`, `guardrails_json`,
  `content_hash`, drafter, model, prompt_version, `input_tokens`, `output_tokens`, `est_cost_usd`, decided_at, decision_note
- Schema version goes 1 -> 2 with an in-place migration that keeps existing data
- **Drafts are immutable**: a trigger aborts any `UPDATE` that changes subject, body, claims, guardrail results or content hash. Only status, decided_at and decision_note may change, and only from `pending_review`.
- `drafter` and `model` record what actually wrote the draft, so a local-model draft can never be mistaken for a Claude one; `est_cost_usd` is `0` for local and template drafts
- The config also carries a `production` target (`claude-sonnet-5-5`, price per MTok $2 input / $10 output, `asOf` date, to be re-verified) used only for Phase 5b projections
- Audit actions added: `draft_created`, `draft_blocked`, `draft_skipped`, `draft_approved`, `draft_rejected`. **Audit detail never holds draft text or lead data**: ids, queue, check ids, token counts, model.

### MCP tools

- `draft_email` `{ leadId }` -> draft id, status, subject, body, cited facts, guardrail report, content hash, model, token usage
- `get_draft` `{ draftId }` -> the full stored draft and report
- `list_drafts` `{ status?, limit? (default 10, max 20) }` -> summaries, no bodies
- `approve_draft` `{ draftId, reviewedHash }` -> only for `pending_review` drafts whose `content_hash` equals `reviewedHash` (forces the exact reviewed content); marks approved. **Sends nothing.**
- `reject_draft` `{ draftId, reasonCode, note? }` -> `reasonCode` is an enum (`off_message`, `inaccurate`, `tone`, `wrong_lead`, `other`); free-text `note` is stored on the draft, never in the audit log
- Tool descriptions state that approval needs a human decision and that `approve_draft` should not be auto-approved by the client

## Out of Scope

- Sending email, sequences, follow-ups, reply handling, HubSpot or Salesforce write-back
- Auto-drafting when a lead arrives by webhook (drafting is a deliberate, human-triggered step in this phase)
- Automatic regeneration after a blocked draft, draft editing, A/B variants
- **Cost per meeting**: split into Phase 5b because it should be computed from the token usage this phase records
- A deliverability gate on approval using `audit_domain` (natural follow-up, mentioned in the Phase 6 docs)
- Real user identity on approvals: MCP has none, so the record says `decided_by: mcp-client`

## Context

- Outbound email is where an AI agent can do real harm: false claims, no opt-out, contacting people who asked not to be contacted. Every guardrail here is a deterministic rule a RevOps or Legal reviewer can read in one sitting.
- The sender identity, postal address and unsubscribe text in `config/sdr.json` are **placeholders**; the sender domain is a reserved invalid one.
- All leads are synthetic. With a local model nothing leaves the machine, but the same data-minimization code path is used, so the behavior carries over to Claude later.
- A probe of `meta-llama-3.1-8b-instruct` through LM Studio (2026-10-08) returned schema-valid JSON in about 8 seconds, but the 8B model wrote the internal fact id `(F-1)` into the email body and spoke as if it were on the lead's team. These are exactly the faults the guardrails and human review exist for, and they motivated `no_internal_ids` and the role-confusion note.
- The MCP client is Claude, which could call `approve_draft` itself. The real control is the client's per-call permission prompt plus the `reviewedHash` requirement; the runbook will say not to allowlist `approve_draft`.

## Decisions to confirm

1. **Local model now, Claude Sonnet later.** `claude-sonnet-5-5` remains the production target, as in `tech-stack.md`; `local` is the default drafter for experimenting. The Anthropic drafter becomes Phase 5c, so no `@anthropic-ai/sdk` dependency and no API key are needed now.
2. **Default local model `meta-llama-3.1-8b-instruct`** (fast, no reasoning output). `qwen/qwen3-14b` is supported and compared in the live check. `SDR_LOCAL_MODEL` switches between them.
3. **Split cost per meeting into Phase 5b**, priced from stored tokens at Sonnet rates as a labeled projection.
4. **`template` drafter** so a reviewer without LM Studio can still run the whole flow. It is labeled in every draft and never selected implicitly.
5. **Approval is a marker, not a send**, and its strength is bounded by the MCP client's permission prompts (see Context).

## Layout

`src/sdr/{facts,suppression,sanitize,prompt,drafter,localDrafter,templateDrafter,guardrails,footer,service}.ts`, `src/db/drafts.ts`,
`src/tools/{draftEmail,getDraft,listDrafts,approveDraft,rejectDraft}.ts`, `config/sdr.json`, `data/approved-facts.json`, `data/suppression.json`
