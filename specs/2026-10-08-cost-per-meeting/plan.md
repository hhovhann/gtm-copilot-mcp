# Phase 5b Plan - Cost per Meeting

## Group 1 - Config

1. `config/economics.json`: opens with a note that every figure is a placeholder; `defaults` (leads per month, touches, funnel rates, review minutes, hourly rate, assumed pass rate, assumed tokens per draft, `minMeasuredDrafts`) and three scenarios (`build`, `buy`, `hybrid`) with fixed monthly items, per-lead items, per-meeting fee, review amount and meeting-rate multiplier; each block tagged `"source": "assumption"`
2. `src/economics/config.ts`: Zod schema (strict), rates between 0 and 1, non-negative money, at least one scenario, unique scenario ids; fail with the field path
3. Tests: the shipped file loads; each invalid case names its path; a number outside its range is rejected; a scenario block without `source` is rejected

## Group 2 - The Model

4. `src/economics/model.ts`: `evaluate(inputs, scenario)` and `compare(inputs, scenarios)` as pure functions; category breakdown; largest driver; zero-meetings error
5. Hand-calculated tests: one worked example per scenario with every intermediate value checked; blocked drafts raise LLM cost (pass rate 0.5 doubles it); a scenario without our own LLM has zero LLM cost; breakdown sums to cost per meeting; zero reply rate gives the clear error, not `Infinity`
6. Crossover: closed form from `a` and `f`; tests with a hand-built pair (known `L*`), parallel curves (no crossover), a negative `L*` (ignored), and the winner on each side of `L*`

## Group 3 - Measured Inputs

7. `src/economics/measure.ts`: SQL over `drafts` excluding the `template` drafter; count, average tokens, pass rate; optional model filter; fallback to assumed values below `minMeasuredDrafts`, with the reason recorded
8. Tests with seeded draft rows: template drafts are excluded; blocked drafts count against the pass rate and still count their tokens; the model filter works; fewer than the minimum falls back and says so; an empty database falls back

## Group 4 - Sensitivity and Recommendation

9. `src/economics/sensitivity.ts`: the cases listed in `requirements.md`, each re-running `compare`; winner per case; flips; robustness count; recommendation object
10. Tests with constructed numbers where the winner provably flips (and one where it provably does not); clamping of the pass rate; the recommendation names the flipping cases

## Group 5 - Tool

11. `src/economics/render.ts`: plain-text table (scenario rows, breakdown, driver, crossover, recommendation, disclaimer) and the JSON shape; every input tagged `measured`, `assumption` or `override`
12. `src/tools/estimateCost.ts`: Zod input (ranges from `requirements.md`), orchestration (measure, merge overrides, compare, sensitivity, render), `tool_call` audit row; register in `src/server.ts`
13. Tests: input ranges rejected at the schema; an override is tagged `override` and changes the result; the disclaimer and the `assumption` tags are present; the output contains no lead data; the audit row holds numbers only; identical inputs give identical output

## Group 6 - Verify

14. `npm run typecheck` and `npm test`
15. Over stdio against the scratch database that holds the real Llama and Qwen drafts: call the tool with defaults, with `measuredModel`, and with overrides; record the table in `validation.md`
16. Mutation checks on the model (swap the pass-rate division, drop the review term, flip the crossover sign) and confirm the tests fail
17. Call from Claude Code: "what does a meeting cost us, build vs buy?"; record the answer
18. Tick `validation.md`, mark Phase 5b done in `roadmap.md`
