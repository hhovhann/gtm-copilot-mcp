# Phase 3 Plan - Lead Scoring and Routing

## Group 1 - Lead Model and Enrichment

1. `src/leads/model.ts`: Zod schema for the lead, `LeadSource` enum, helper to derive and normalize the email domain
2. Create `data/companies.json` with about 12 synthetic companies spanning sizes, industries, `call_center` and `developer` hints; mark the file as synthetic
3. `src/leads/enrich.ts`: `Enricher` interface, `MockEnricher` reading the JSON, result status `found` or `not_found`
4. Tests: domain derivation (case, whitespace, subdomain email), known and unknown domains

## Group 2 - Config

5. `src/leads/config.ts`: Zod schema for scoring rules, routing rules, thresholds, free-mail list and blocklist
6. Create `config/routing.json` with the rules from `requirements.md`
7. Loader that fails with an error naming the invalid field path
8. Tests: valid config loads; unknown rule type, missing threshold and duplicate rule ids are rejected

## Group 3 - Scoring

9. `src/leads/score.ts`: evaluate fit, persona and intent rules, return a breakdown and a clamped total
10. Tests: each group in isolation, keyword matching is case-insensitive, breakdown sum equals the pre-clamp total, clamping at 0 and 100

## Group 4 - Routing

11. `src/leads/route.ts`: evaluate routing rules in order, first match wins, record why earlier rules did not match
12. `needs_review` when enrichment is `not_found` and intent points meet the threshold
13. Tests: one case per route, free-mail domain, blocked domain, rule-order precedence, enrichment missing

## Group 5 - MCP Tool

14. `src/tools/routeLead.ts`: input schema, orchestration (enrich, score, route), text summary plus JSON
15. Register `route_lead` in `src/server.ts`, injecting the `Enricher` and config like the DNS resolver
16. Tests: invalid email and over-long `message` are rejected; same input gives identical output twice

## Group 6 - Verify

17. Run `npm run typecheck` and `npm test`
18. Over stdio, call `route_lead` for one lead per route and confirm the explanation matches the config
19. Call it from Claude Code with "why did this lead go to enterprise?" style questions; record results in `validation.md`
20. Mark Phase 3 done in `roadmap.md`
