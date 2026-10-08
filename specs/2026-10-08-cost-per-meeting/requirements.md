# Phase 5b Requirements - Cost per Meeting (Build vs Buy vs Hybrid)

## Goal

An `estimate_cost_per_meeting` MCP tool that answers the question the Krisp posting asks for by name:
*"Evaluate build vs. buy vs. hybrid, bring a clear recommendation with cost per meeting."*
It compares three ways to run an AI SDR, shows exactly where the money goes, says how far to trust the answer, and gives a recommendation.

The tool is a **calculator with visible assumptions, not an oracle**. Every number is either **measured** (from this project's own stored drafts) or an **assumption** (a placeholder that RevOps replaces with real data). The output never blurs the two.

## Scope

### The cost model (pure function, no I/O)

For each scenario, per month, with `L` = leads worked per month:

- `meetingsPerLead = replyRate x positiveShare x meetingFromPositive x showRate x scenario.meetingRateMultiplier`
- `meetings = L x meetingsPerLead`
- `costPerDraft = (avgInputTokens x inputPrice + avgOutputTokens x outputPrice) / 1,000,000`
- `llmPerLead = touchesPerLead x costPerDraft / passRate` (blocked drafts cost tokens too, so a low pass rate raises cost). Only for scenarios that draft with our own LLM.
- `reviewPerLead = reviewedDraftsPerLead x reviewMinutesPerDraft / 60 x loadedHourlyRate`
- `variablePerLead = sum(scenario.variablePerLead items) + llmPerLead + reviewPerLead`
- `monthlyCost = sum(scenario.fixedMonthly items) + L x variablePerLead + scenario.perMeetingFee x meetings`
- `costPerMeeting = monthlyCost / meetings`
- Output also splits cost per meeting into categories (fixed items, enrichment, LLM, human review, vendor fees) and names the **largest driver**, computed, never hard-coded
- If `meetings` is 0 (any rate is 0), the tool returns a clear error, never `Infinity` or `NaN`

### Scenarios (`config/economics.json`)

| Id | Meaning | Shape |
|---|---|---|
| `build` | the stack in this repo: routing, enrichment, guarded drafting, human approval | fixed engineering upkeep and infrastructure; our LLM; full human review of the first touch |
| `buy` | a vendor AI SDR platform | platform fee plus a per-meeting fee; no LLM cost on our side; light review |
| `hybrid` | a vendor for sequencing and sending, our own routing and guardrails in front | smaller platform fee; our LLM and review; some upkeep |

- Every number in the file sits in a block marked `"source": "assumption"` and the file opens with a note that **these are placeholders, not benchmarks and not Krisp's figures**
- Vendor figures need real quotes; the tool says so in its output

### Measured inputs (from the SQLite database)

- From stored drafts made by a model drafter (the `template` drafter is excluded because it uses no tokens): draft count, average input and output tokens, and **guardrail pass rate** (share of drafts not blocked)
- Optional `measuredModel` narrows the sample to one model (for example `qwen/qwen3-14b`)
- If fewer than `minMeasuredDrafts` (default 10) drafts exist, the tool falls back to the config's assumed tokens and pass rate and **says that it did**
- Tokens are priced at the production model's list rates from `config/sdr.json` (`claude-sonnet-5-5`, $2 / $10 per MTok, with its `asOf` date). Tokens measured on a local model are only an approximation of Claude's token counts, so the output labels the LLM line a **projection**.

### Tool: `estimate_cost_per_meeting`

- Input (all optional):
  - `leadsPerMonth` (integer 10 to 1,000,000, default from config)
  - `scenarios` (subset of `build`, `buy`, `hybrid`)
  - `measuredModel` (string)
  - `overrides`: `replyRate`, `positiveShare`, `meetingFromPositive`, `showRate` (each 0 to 1), `touchesPerLead` (1 to 10), `reviewedDraftsPerLead` (0 to 10), `reviewMinutesPerDraft` (0 to 60), `loadedHourlyRate` (0 to 500), `passRate` (0.01 to 1)
- Output: a plain-text summary plus JSON containing
  - `inputs` with each value tagged `measured`, `assumption` or `override`
  - one row per scenario: meetings per month, monthly cost, cost per lead, cost per meeting, per-meeting breakdown, largest driver
  - **crossovers**: the volume at which one scenario becomes cheaper than another (closed form, below)
  - **sensitivity**: the winner re-evaluated under changed assumptions, and whether the recommendation flips
  - **recommendation**: the cheapest scenario, its margin over the runner-up, how many sensitivity cases it survives, and the cases where it flips
  - a `disclaimer` string that the numbers are assumptions unless tagged measured
- The tool never names a vendor and never claims a benchmark

### Crossover (closed form)

Cost per meeting is `a + f / L` with `a = variablePerLead / meetingsPerLead + perMeetingFee` and `f = fixedMonthly / meetingsPerLead`.
Two scenarios cross where `L* = (f_A - f_B) / (a_B - a_A)`, reported only when `L*` is positive and finite, with which side wins below and above it.

### Sensitivity cases

Each re-runs the whole comparison: reply rate x0.5 and x1.5; review minutes x0.5 and x1.5; leads per month x0.5 and x2; pass rate -0.2 and +0.1 (clamped); loaded hourly rate x0.5 and x1.5. The output counts how many cases keep the same winner and lists the ones that flip.

### Audit

- Each call writes a `tool_call` audit row with the tool name, `leadsPerMonth` and the number of scenarios: numbers only, nothing else

## Out of Scope

- Real vendor pricing, currency conversion, taxes, discounts, ramp-up and contract terms
- Multi-touch attribution, seasonality, forecasting, or modeling reply rates by segment
- Persisting scenarios, charts or a UI (the video shows the text table)
- Changing the approval policy to review fewer drafts; that is a business decision the tool can price but not make
- Any claim about Krisp's actual funnel, costs or headcount

## Context

- The human-review line is deliberately modeled: in this design nothing can be sent without approval, so review minutes are a real cost. The sensitivity analysis shows how much the answer depends on it.
- Guardrail pass rate links Phase 5 to the economics: a draft that gets blocked still cost tokens. The pass rates measured from the two local models (about half to two thirds) are **not** a prediction for Claude, so `passRate` is overridable and the output says where it came from.
- Placeholder numbers will produce a plausible-looking dollar figure. The disclaimer, the `assumption` tags and the "replace with your data" note exist so that figure cannot be mistaken for evidence.

## Decisions to confirm

1. **All funnel, cost and vendor numbers are placeholders**, tagged as such, with no claim about Krisp. You or RevOps replace them in `config/economics.json` or per call through `overrides`.
2. **What `hybrid` means:** a vendor handles sequencing and sending, while our routing, approved facts and guardrails stay in front of it. If you see it differently, the scenario is a config edit.
3. **Review is modeled for the first touch only** (`reviewedDraftsPerLead` default 1), because every draft needs approval in this design; follow-ups are variants of the approved first email.
4. **The recommendation rule is "cheapest cost per meeting, plus robustness and crossover"**, not a verdict, and it flags when it would flip.
5. **Tokens measured on local models, priced at Sonnet list rates** is a labeled projection until Phase 5c measures real Claude usage.

## Layout

`src/economics/{config,measure,model,sensitivity,render}.ts`, `src/tools/estimateCost.ts`, `config/economics.json`
