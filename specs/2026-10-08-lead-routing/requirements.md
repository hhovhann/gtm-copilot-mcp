# Phase 3 Requirements - Lead Scoring and Routing

## Goal

A `route_lead` MCP tool that takes an inbound lead, enriches it from mock data, scores it, routes it to an owner or queue,
and explains exactly which rules fired. This is the "lead routing, enrichment, scoring and handoffs should just work" slice.
The key property is **explainability**: a RevOps person can always ask "why did this lead go there?" and get a rule-level answer.

## Scope

- Lead model (Zod): `email`, `firstName`, `lastName`, `title` (optional), `source`, `message` (optional)
  - `source` is one of `demo_request`, `pricing_page`, `webinar`, `content_download`, `partner`, `other`
  - The company domain is derived from the email; the raw domain is never trusted beyond hostname validation
- **Mock enrichment** (Clay-style) from `data/companies.json`, keyed by domain:
  `name`, `employees`, `industry`, `country`, `segmentHints` (e.g. `call_center`, `developer`)
  - Unknown domain -> enrichment status `not_found`; the lead is still scored on what is known
- **Scoring** (0-100, additive, config-driven), three groups with named rules:
  - **Fit**: company size band, industry match, country
  - **Persona**: title seniority and function keywords
  - **Intent**: lead source, message keywords (e.g. "pricing", "pilot", "SDK")
- **Routing**, config-driven, ordered, first match wins:
  - `disqualify` (free-mail domain, blocked domain list, no usable email)
  - `developer_sdk` (segment hint `developer` or developer keywords in the message)
  - `call_center_specialist` (segment hint `call_center`)
  - `enterprise_ae` (employees >= threshold and score >= threshold)
  - `midmarket_ae`
  - `smb_nurture` (default), and `needs_review` when enrichment is missing and intent is high
- Config lives in `config/routing.json`, validated by Zod at load time; invalid config fails with a clear message naming the bad field
- Output: `score`, `scoreBreakdown` (each rule: id, group, points, reason), `route` (queue id and label),
  `routeReason` (the rule that matched and why earlier rules did not), `enrichment` (data used and status), and a text summary
- Deterministic: the same lead and config always give the same result; no LLM is involved in this phase

## Out of Scope

- Persisting leads or decisions (Phase 4), webhook intake (Phase 4)
- Real enrichment APIs (Clay, Clearbit), real CRM assignment, round-robin among individual reps
- ML scoring, score decay over time, deduplication and account matching
- Any email sending or drafting (Phase 5)

## Context

- All data in `data/companies.json` is synthetic and must be labeled so in the file.
- Free-mail domains (gmail.com, outlook.com, etc.) have no company to enrich; they are not an error, they route to `disqualify` or `smb_nurture` per config, with a stated reason.
- Lead fields such as `message` and `title` are untrusted text. They are only matched against keyword lists, never executed or sent to an LLM here.
- Scores clamp to 0-100; the breakdown must sum to the pre-clamp total so that the explanation is auditable.

## Decisions

- Config format: JSON, validated with Zod. YAML would be friendlier for RevOps, but JSON adds no dependency; revisit if the config grows.
- Layout: `src/leads/{model,enrich,score,route,config}.ts`, `src/tools/routeLead.ts`, `config/routing.json`, `data/companies.json`
- Enrichment sits behind an `Enricher` interface (like `DnsResolver`) so a real Clay-style API can replace the mock later
