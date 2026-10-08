# Phase 2 Plan - Deliverability Auditor

## Group 1 - DNS Boundary

1. Define `DnsResolver` in `src/dns/resolver.ts` with `resolveTxt(name)` returning joined strings, or a typed error
2. Implement the real resolver on `node:dns/promises`; map `ENOTFOUND`/`ENODATA` to "no records" and other errors to "lookup failed"
3. Add a `FakeResolver` test helper that serves canned records and failures

## Group 2 - Individual Checks

4. `src/audit/spf.ts`: parse, return findings (multiple records, missing/weak `all`, lookup count over 10)
5. `src/audit/dmarc.ts`: parse tags, return findings (missing, `p=none`, no `rua`, `pct` under 100)
6. `src/audit/dkim.ts`: try default plus supplied selectors, return found selectors and findings
7. Unit tests per check using the fake resolver, including malformed records and lookup failures

## Group 3 - Scoring and Report

8. `src/audit/score.ts`: combine check results into a 0-100 score and a sorted fix list (critical first)
9. `src/audit/index.ts`: `auditDomain(domain, resolver, options)` returning the structured report
10. Tests for scoring: perfect setup, no records, SPF only, "could not check" excluded from the score and flagged

## Group 4 - MCP Tool

11. `src/tools/auditDomain.ts`: Zod schema (hostname regex, selector list cap) and handler returning JSON plus a text summary
12. Register `audit_domain` in `src/server.ts`; reject invalid domains with a clear tool error
13. Test the handler with an invalid domain (`http://x.com`, `a b`, empty, over 253 chars)

## Group 5 - Verify

14. Run `npm run typecheck` and `npm test`
15. Over stdio, call `audit_domain` against a real domain and a deliberately bad one (`nonexistent.invalid`)
16. Call it from Claude Code and read the summary back; record the results in `validation.md`
17. Mark Phase 2 done in `roadmap.md`
