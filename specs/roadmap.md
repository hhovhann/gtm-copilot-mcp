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

## Phase 5 - AI SDR Drafter with Guardrails (local model)
- `draft_email` tool: a local LLM (LM Studio) drafts from lead + approved-facts file; `template` drafter for offline runs
- Guardrails in code: eligibility and suppression before any model call, approved-claims check, no links or internal ids, code-appended unsubscribe footer
- Immutable drafts, approval queue; nothing is sent; `get_draft`, `list_drafts`, `approve_draft` (needs the reviewed hash), `reject_draft` tools

## Phase 5b - Cost per Meeting
- `estimate_cost_per_meeting` tool with documented assumptions, priced from the token usage Phase 5 stores (labeled projection at Sonnet rates)

## Phase 5c - Claude Drafter
- Anthropic SDK drafter on `claude-sonnet-5-5` behind the same `Drafter` interface; live check compared with the local models

## Phase 6 - Docs and Demo
- README (what it is, how you use it, quickstart verified from a clean clone), `docs/architecture.md` (five validated Mermaid diagrams) and `docs/safety.md` (threat model, evidence, stated limits): drafted
- `docs/runbook.md` (operations, nine audit queries, playbooks, known gaps) and `docs/data-rules.md` (inventory, data flows, governance, retention and erasure gaps): written; every procedure was run on a scratch database
- Demo video, 2 to 3 minutes, **final file under 25 MB** (check with `ls -l`/`ffprobe`; re-encode if over). Same format as the travel-assistant video (1920x1080 H.264, AAC, soft subtitles, plus `.srt`)
  - Synthetic voice from macOS `say` (one narration script, one audio file per slide)
  - Simple, clear slides: Markdown -> `pandoc` (pptx) -> `soffice` (pdf) -> `pdftoppm` (png); one idea per slide, large text
  - Demo slides show **real captured output** from the MCP tools, not mock-ups; `ffmpeg` joins slides and audio, with timing taken from each audio file
  - Build script lives in the repo (`docs/video/build.sh`) so the video can be regenerated
- Short cover note for the Krisp team

---

## Replanning Log
_Add dated notes here when scope changes._

- 2026-10-08 (Phase 4): storage driver changed from `better-sqlite3` to built-in `node:sqlite` to avoid a native build on Node 25; engine floor raised to Node 22.5+. Added `list_leads` to Phase 4.
- 2026-10-08 (Phase 5): drafting runs on a local LM Studio model first (free, nothing leaves the machine); `claude-sonnet-5-5` stays the production target. Phase 5 split into 5 (drafter, guardrails, approval queue), 5b (cost per meeting) and 5c (Claude drafter).
