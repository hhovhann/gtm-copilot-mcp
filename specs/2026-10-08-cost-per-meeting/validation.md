# Phase 5b Validation - Cost per Meeting

Phase 5b is done when every box below is checked. Everything under Automated runs with no network, no model and no key.

## Automated

- [x] `npm run typecheck` exits 0
- [x] `npm test` passes
- [x] Config: the shipped file loads; invalid cases name the field path; rates outside 0 to 1, negative money, duplicate scenario ids and a block without `source` are rejected

## The model (hand-calculated)

- [x] One worked example per scenario matches the hand calculation for meetings per lead, LLM cost per lead, review cost per lead, monthly cost and cost per meeting
- [x] A pass rate of 0.5 doubles the LLM cost per lead; a scenario without our own LLM has none
- [x] The category breakdown sums to the cost per meeting, and the largest driver is the largest category
- [x] Any rate of 0 gives a clear error, never `Infinity` or `NaN`
- [x] Doubling `leadsPerMonth` lowers cost per meeting only through the fixed costs, as the formula predicts

## Crossover

- [x] A hand-built pair crosses at the expected volume and the winner flips at that volume
- [x] Parallel curves report no crossover; a negative crossover is ignored

## Measured inputs

- [x] `template` drafts are excluded; blocked drafts lower the pass rate and still count their tokens
- [x] `measuredModel` narrows the sample to that model
- [x] Fewer than `minMeasuredDrafts` (or an empty database) falls back to assumed values **and the output says so**
- [x] Tokens are priced at the production model's rates, and the output shows the model name and its `asOf` date

## Sensitivity and recommendation

- [x] Every sensitivity case re-runs the full comparison
- [x] A constructed case where the winner flips is reported as a flip and named; one where it does not flip reports full robustness
- [x] The recommendation states the winner, its margin over the runner-up, the robustness count and the flipping cases
- [x] Pass rate is clamped to its valid range under sensitivity

## Honesty of the output

- [x] Every input is tagged `measured`, `assumption` or `override`
- [x] The disclaimer is in both the text and the JSON
- [x] The tool never names a vendor and never states a benchmark
- [x] The output contains no lead data; the audit row holds the tool name, `leadsPerMonth` and the scenario count only
- [x] Identical inputs give identical output

## Tool and protocol

- [x] Input ranges are enforced at the schema (`leadsPerMonth`, each override, scenario names)
- [x] `tools/list` shows the ten existing tools plus `estimate_cost_per_meeting`
- [x] Nothing other than MCP messages is written to stdout

## Live (stdio, scratch database with the real Llama and Qwen drafts; run 2026-10-08)

**All funnel, cost and vendor numbers below are placeholders. The only measured inputs are token counts and the guardrail pass rate.**

- [x] Default call (2,000 leads per month; 30 stored drafts from two local models: 473 input and 100 output tokens per draft, pass rate 63%, all tagged `measured`; the rest `assumption`):

  | Scenario | Meetings/mo | Monthly cost | Cost/meeting | Largest driver |
  |---|---|---|---|---|
  | Hybrid | 9.0 | $4,085 | $454 | human review (49%) |
  | Buy | 9.0 | $4,280 | $476 | platform fee (58%) |
  | Build | 9.0 | $4,425 | $492 | human review (45%) |

  Recommendation: Hybrid, 5% below Buy, **but the tool says the margin is small and the options are roughly equal on cost**. It stays cheapest in 6 of 10 sensitivity cases and loses to Buy when reply rate halves, review minutes rise, volume doubles, or the hourly rate rises. Crossovers: build vs buy about 1,469 leads per month, buy vs hybrid about 2,432, build vs hybrid about 3,889.
- [x] **The model is not the expensive part.** LLM cost is $2 to $3 per meeting (under 1%); human review is 45% to 49% of build and hybrid. Guardrail pass rate measured per model (Llama 67% over 18 drafts, Qwen 58% over 12) moved cost per meeting by under $1, so the difference between the two local models barely matters economically. This follows from the computed breakdown, not from a hard-coded claim.
- [x] `measuredModel` for each local model and for `template-v1` works; `template-v1` correctly falls back ("only 0 model drafts for template-v1 stored") instead of treating zero-token template drafts as real usage
- [x] Override call (10,000 leads, reply rate 0.08, review 0.5 min, all tagged `override`): Build $78, Hybrid $111, Buy $172 per meeting; Build cheapest by 29% in 10 of 10 sensitivity cases
- [x] Small-volume call (500 leads, two scenarios): Build $1,192 vs Buy $1,309, 9% apart, flagged as roughly equal
- [x] Error paths: `replyRate: 0` returns "No meetings result from these inputs (replyRate is 0)..."; `leadsPerMonth: 5` is rejected by the schema
- [ ] Asking Claude Code "what does a meeting cost us, build vs buy?" returns an answer that matches the table and repeats the disclaimer (manual: needs the server registered in Claude Code)

### What this shows (and does not)

With these placeholder inputs the three options are within about 8% of each other at 2,000 leads per month, and which one wins depends on volume and on how long humans spend reviewing. That is the honest finding: **the decision turns on review time, volume and vendor quotes, none of which this pilot can supply.** It is not evidence that any option is cheaper in reality.

## Mutation checks

- [x] 16 deliberate breakages were applied one at a time and each made the suite fail: pass-rate division removed, review cost dropped, review share ignored, own-LLM flag ignored, per-meeting fee dropped, crossover sign flipped, negative crossover accepted, zero-meetings guard removed, template drafts counted (both branches), blocked drafts not counted against pass rate, pass rate allowed to be zero, override not tagged, sensitivity never flipping, disclaimer missing from JSON, audit row leaking data
- [x] **One survivor was found and fixed:** with a model filter, counting the template drafter's zero-token drafts went unnoticed. A regression test now covers `measuredModel: "template-v1"`, and the mutation fails the suite. All mutations were reverted.

## Hygiene

- [x] No new dependencies
- [x] `config/economics.json` opens with the placeholder note and every block is tagged `assumption`
- [ ] `roadmap.md` Phase 5b is marked done
