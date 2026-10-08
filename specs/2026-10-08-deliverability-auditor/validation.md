# Phase 2 Validation - Deliverability Auditor

Phase 2 is done when every box below is checked.

## Automated

- [x] `npm run typecheck` exits 0
- [x] `npm test` passes with no network access (all DNS is faked)
- [x] SPF: single valid record passes; two records, `+all`, `?all`, missing `all` and 11+ lookup mechanisms each raise the right finding
- [x] DMARC: `p=reject` with `rua` scores full; `p=none`, missing `rua`, `pct<100` and no record each raise the right finding
- [x] DKIM: found under a default selector, found under a supplied selector, and not found (message says "not found under selectors tried")
- [x] Scoring: perfect setup = 100, no records = 0, SPF-only lands between, fixes sorted critical to info
- [x] A DNS failure is reported as "could not check" and does not count as pass or fail

## Input Safety

- [x] Rejected before any lookup: `http://x.com`, `x.com/path`, `a b`, empty string, 254+ characters
- [x] More than 10 `dkimSelectors` is rejected

## Protocol

- [x] `tools/list` shows `ping` and `audit_domain`
- [x] `audit_domain` over stdio returns structured JSON and a text summary
- [x] Nothing other than MCP messages is written to stdout

## Live Check

- [x] A real domain with known SPF/DMARC returns plausible findings (record the domain and result here) -> github.com: 90/100 (SPF ~all softfail, DMARC quarantine, DKIM found)
- [x] `nonexistent.invalid` returns a score of 0 with missing-record fixes, not a crash
- [ ] Asking Claude Code "audit example.com" produces a readable summary

## Hygiene

- [x] No new `^` or `~` ranges in `package.json`
- [ ] `roadmap.md` Phase 2 is marked done
