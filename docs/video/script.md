# Demo video script

Target length: under 3 minutes, 11 slides, synthetic voice. Each `>` paragraph is the narration for that slide, read as written. `pronunciations.json` fixes how the voice says acronyms; the on-screen text and subtitles keep the normal spelling.

Every number spoken here is traceable: 352 tests (`npm test`), eight guardrails (`src/sdr/guardrails.ts`), 0 of 6 injected drafts obeyed (`specs/2026-10-08-sdr-drafter-guardrails/validation.md`), cost figures (`docs/video/captures/cost.txt`, placeholder assumptions).

## 1. Title

**On screen:** GTM Copilot. Work with your revenue stack through Claude, safely. Pilot, synthetic data, nothing is sent.

> This is GTM Copilot, a pilot that lets a revenue team work with its tools through Claude, safely. It uses synthetic data, and nothing is ever sent.

## 2. The problem

**On screen:** Three questions RevOps cannot answer quickly. Why did this lead go to that rep? Will our email reach the inbox? What will an AI writing outreach say?

> Revenue operations runs on tickets and guesswork. Why did this lead go to that rep? Is our email set up to reach the inbox? And an AI that writes outreach can say anything, to anyone. The goal is fewer tickets, with controls you can inspect.

## 3. The idea

**On screen:** Diagram. You, Claude, MCP server, database, webhook. No new interface to learn.

> There is no new interface to learn. You ask Claude in plain language, and Claude calls tools on an MCP server. Leads arrive through a small webhook, and everything lands in one database, with an audit log.

## 4. How a lead flows

**On screen:** Four steps. Check the secret and validate. Score and route with plain rules. Store the decision and the reason. Explain it later, exactly as decided.

> When a lead arrives, the webhook checks the secret and validates it, then scores and routes it with plain rules. It stores the decision and the reason. Later, anyone can ask why, and get the answer exactly as it was decided.

## 5. Demo: deliverability

**On screen:** Terminal. Prompt: Audit the email authentication for github.com. Real output: 90 out of 100, SPF, DKIM, DMARC, two info-level fixes.

> First, deliverability. I ask Claude to audit a domain. It checks SPF, DKIM and DMARC over public DNS, and returns a score, with the fixes ranked by severity.

## 6. Demo: why this route

**On screen:** Terminal. Prompt: Why did lead 4 go to mid-market, not enterprise? Real output: score 35, each rule that fired, enterprise skipped because the score was below 60.

> Next, routing. Why did this lead go to mid-market, and not enterprise? The answer lists every rule that fired. A score of thirty-five, where enterprise needs sixty.

## 7. Demo: the AI SDR and its guardrails

**On screen:** Two terminals. Left: a real local-model draft, blocked, "a greeting alone is not an email". Right: a lead whose message tried to hijack the model; the message was withheld.

> Now the AI SDR. It drafts from approved facts only, then eight checks run in code. Here, a local model wrote an email that was only a greeting, and it was blocked. When a lead's message tried to hijack the model, the message was withheld, and the draft stayed clean.

## 8. Safe by design

**On screen:** The model proposes. Code checks. A human decides. Five points: no tools, hostile input, immutable drafts, approval needs the hash, nothing is sent. 0 of 6 injected drafts obeyed.

> The principle is simple. The model proposes, code checks, and a human decides. The model has no tools. Lead text is treated as hostile. Drafts cannot be edited after review, approval needs the exact content hash, and nothing is sent. In live runs, none of six injected drafts obeyed the attack.

## 9. Cost per meeting

**On screen:** Table. Build, buy, hybrid, with cost per meeting. Banner: placeholder assumptions. Human review is the biggest cost.

> Then the question your team will ask: build, buy, or hybrid? The tool compares cost per meeting, and shows where the money goes. With placeholder numbers, the options are close. In build and hybrid, human review is the biggest cost, and the model is under one percent. The real answer depends on vendor quotes and volume.

## 10. How it was built

**On screen:** Spec first. Mission, tech stack, roadmap. Then for each phase: requirements, plan, validation. 352 tests. Security code broken on purpose. Real models found two gaps.

> I built it spec first. A mission, a tech stack and a roadmap, then requirements, a plan and a validation checklist for every phase. There are three hundred fifty-two tests, and I broke the security code on purpose to prove the tests catch it. Running real models found two gaps the tests had missed, and I fixed them.

## 11. What is next

**On screen:** Next. Connectors for HubSpot, Salesforce, Clay and Gong. A Claude drafter. A deliverability gate on approval. github.com/hhovhann/gtm-copilot-mcp

> With access to your stack, the next steps are connectors for HubSpot, Salesforce, Clay and Gong, a Claude drafter, and a deliverability gate on approval. The code, the specs and a runbook are on GitHub. Thank you.
