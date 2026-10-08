# Phase 3 Validation - Lead Scoring and Routing

Phase 3 is done when every box below is checked.

## Automated

- [x] `npm run typecheck` exits 0
- [x] `npm test` passes with no network access and no files outside the repo
- [x] Domain derivation: `Jane@ACME.com ` -> `acme.com`; an email without a valid domain is rejected
- [x] Enrichment: known domain returns `found` with data; unknown domain returns `not_found` without throwing
- [x] Config: valid file loads; each invalid case (unknown rule type, missing threshold, duplicate id) fails with the field path in the message
- [x] Scoring: fit, persona and intent each add the expected points; keywords are case-insensitive
- [x] Scoring: breakdown points sum to the pre-clamp total; the final score is clamped to 0-100
- [x] Routing: one test per route (`disqualify`, `developer_sdk`, `call_center_specialist`, `enterprise_ae`, `midmarket_ae`, `smb_nurture`, `needs_review`)
- [x] Routing: rule order is respected (a lead matching two routes gets the earlier one, and `routeReason` names why)
- [x] Free-mail and blocked domains follow the config and state the reason
- [x] Determinism: the same lead run twice produces identical output

## Input Safety

- [x] Invalid email, missing required fields, unknown `source` and `message` over the length cap are rejected
- [x] `message` and `title` are only keyword-matched; nothing in them changes routing logic beyond the configured keywords

## Protocol

- [x] `tools/list` shows `ping`, `audit_domain` and `route_lead`
- [x] `route_lead` over stdio returns a text summary plus structured JSON including `scoreBreakdown` and `routeReason`
- [x] Nothing other than MCP messages is written to stdout

## Live Check

- [x] Seven example leads, one per route, each route and score explained correctly (record the table here)

  | Lead (synthetic) | Score | Route | Rule |
  |---|---|---|---|
  | x@mailinator.com | 0 | disqualify | blocked_domain |
  | CTO @ devtools-inc.example, message "SDK" | 80 | developer_sdk | developer_message |
  | Dir. Ops @ megacontact.example, demo | 95 | call_center_specialist | call_center_segment |
  | VP Ops @ orbitbank.example, demo | 95 | enterprise_ae | enterprise (8000 emp >= 1000, score 95 >= 60) |
  | Manager @ brightpath.example, content | 35 | midmarket_ae | midmarket (enterprise skipped: score 35 < 60) |
  | @ tinystudio.example, webinar | 8 | smb_nurture | default |
  | @ unknownco.example, pricing + "pilot" | 30 | needs_review | unknown_company_high_intent (intent 30 >= 20) |
- [ ] Asking Claude Code "why did this lead go to enterprise?" gives an answer that matches the breakdown

## Data Hygiene

- [x] `data/companies.json` is labeled synthetic and contains no real personal data
- [x] No new `^` or `~` ranges in `package.json`
- [ ] `roadmap.md` Phase 3 is marked done
