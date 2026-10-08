# Phase 5 Plan - AI SDR Drafter with Guardrails

## Group 0 - Constitution Update (on approval)

1. `specs/tech-stack.md`: LLM row becomes "local model via LM Studio's OpenAI-compatible API for development; `claude-sonnet-5-5` is the production target (Phase 5c)"; add the env vars. **No new dependencies**: the local drafter uses `fetch`.
2. `specs/roadmap.md`: split Phase 5 into Phase 5 (local drafter, guardrails, approval queue), Phase 5b (`estimate_cost_per_meeting`) and Phase 5c (Anthropic drafter, `claude-sonnet-5-5`); add a Replanning Log entry
3. Re-run the LM Studio probe (a structured-output request to `http://127.0.0.1:1234/v1/chat/completions`) at the start to confirm the server and both models are still available

## Group 1 - Data and Config

4. `data/approved-facts.json` (descriptive only, `pilot-placeholder`), `data/suppression.json`, `config/sdr.json` (queues, limits, local base URL, model, temperature, timeout, `max_tokens`, footer, never-claim and injection patterns, `production` target with price and `asOf`)
5. `src/sdr/facts.ts`, `src/sdr/suppression.ts`, config loader: Zod schemas, fail with the field path, reject duplicate fact ids and facts allowed for unknown queues
6. Tests: valid files load; each invalid case names its path; suppression matches email and domain case-insensitively

## Group 2 - Schema v2 and Draft Storage

7. `src/db/schema.ts`: bump to version 2; add `drafts` table and the immutability trigger; migrate a v1 database in place
8. `src/db/drafts.ts`: insert, get, list, `transition` (only from `pending_review`), counts for the cost guards
9. Tests: migration from a real v1 database keeps leads, decisions and audit rows; trigger blocks changing subject, body, claims, report and hash; status can only move from `pending_review`; counts are right

## Group 3 - Before the Model

10. `src/sdr/sanitize.ts`: truncate to 500 characters, detect instruction-like patterns, drop on match
11. `src/sdr/prompt.ts`: system prompt and user content builder; **the only place lead data is turned into model input**; `PROMPT_VERSION` constant
12. Eligibility function: queue, suppression, per-lead and daily limits, each with a reason code
13. Tests with a spy drafter: ineligible leads never reach the drafter; model input contains first name, company and queue facts and **not** the email or last name; an injection-style message is dropped and flagged; a long message is truncated

## Group 4 - Drafters

14. `src/sdr/drafter.ts`: `Drafter` interface and result type (`ok` with draft and usage, or a failure code)
15. `src/sdr/localDrafter.ts`: `POST {baseUrl}/chat/completions` with `fetch` (injectable), `response_format` json_schema, configured temperature and `max_tokens`, `AbortSignal` timeout; loopback-only base URL check; strip a leading `<think>` block; validate with Zod; map `finish_reason: "length"`, empty content and invalid output to failure codes; read `usage`
16. `src/sdr/templateDrafter.ts`: deterministic email composed from the cited facts; `template-v1`, zero tokens
17. Drafter selection from `SDR_DRAFTER`; `anthropic` returns a clear "reserved for Phase 5c" error
18. Tests (no LM Studio, no network, `fetch` stubbed): success, `<think>` stripped, `length` truncation, invalid JSON, schema-invalid JSON, empty content, HTTP 500, connection refused (error names LM Studio and the URL), timeout, non-loopback URL refused unless `SDR_ALLOW_REMOTE_LLM=1`; template drafter output passes the guardrails for every draftable queue

## Group 5 - Guardrails and Footer

18. `src/sdr/footer.ts`: append the footer in code; detect a model-written footer
19. `src/sdr/guardrails.ts`: the eight checks plus `notChecked`; pure function returning a report
20. Table-driven tests, one passing and one failing case per check, including: a fact id such as `F-1` in the body (the real fault seen in the Llama probe), a `{{placeholder}}`, `SOC 2` with and without a supporting cited fact, a number that is and is not in a cited fact, a URL, a bare email address, a domain-like token, "as we discussed", over-length subject and body, uncited fact id, fact not allowed for the queue
21. **Adversarial test**: a scripted drafter that obeys an injection (adds a link and a discount claim) is blocked, independently of the sanitizer

## Group 6 - Service and Tools

22. `src/sdr/service.ts`: `createDraft(leadId)`: load lead and stored decision, eligibility, build input, call the drafter **outside any DB transaction**, run guardrails, then insert draft and audit rows in one transaction that re-checks the limits
23. `src/tools/{draftEmail,getDraft,listDrafts,approveDraft,rejectDraft}.ts` with Zod inputs; `ToolError` for not-found and illegal transitions
24. Register in `src/server.ts` with an injectable drafter, defaulting from `SDR_DRAFTER`; `.env.example` gets `SDR_DRAFTER`, `SDR_LOCAL_BASE_URL`, `SDR_LOCAL_MODEL`, `SDR_ALLOW_REMOTE_LLM`
25. Tests: blocked drafts cannot be approved; wrong `reviewedHash` is refused and the draft stays pending; second approve or reject is refused; reject stores the note but the audit detail holds only the reason code; audit rows carry no lead data or draft text after a full scenario

## Group 7 - Verify

26. `npm run typecheck` and `npm test` (no network, no LM Studio)
27. Offline end to end with the `template` drafter: webhook-created leads, then over stdio `draft_email` for each queue, one suppressed lead, one `needs_review` lead, `get_draft`, `approve_draft`, `reject_draft`, and the audit log
28. **Local model check (free, runs on this machine):** with LM Studio running, `SDR_DRAFTER=local` on a handful of synthetic leads with `meta-llama-3.1-8b-instruct`, then again with `qwen/qwen3-14b`; plus one lead with an injection-style message. Record pass and block rates per model, the check ids that fired, tokens and latency. Loading a model uses this machine's RAM and GPU, so I will say which model I am loading.
29. Call from Claude Code: draft, read, approve with the hash; record the result
30. Tick `validation.md`, mark Phase 5 done in `roadmap.md`
