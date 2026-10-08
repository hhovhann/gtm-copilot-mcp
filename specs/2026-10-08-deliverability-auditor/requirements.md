# Phase 2 Requirements - Deliverability Auditor

## Goal

An `audit_domain` MCP tool that checks a sending domain's email authentication (SPF, DKIM, DMARC) using public DNS,
and returns a 0-100 score with prioritized fixes. This is the first real GTM capability: "inbox placement is your number."

## Scope

- `audit_domain` tool:
  - Input: `domain` (string, validated as a hostname, no scheme/path), optional `dkimSelectors` (string array, max 10)
  - Output: score, per-check results, prioritized fix list, and the raw records found
- Checks:
  - **SPF**: a single `v=spf1` TXT record exists; flag multiple records, missing `all` mechanism, `+all`, `?all`,
    and more than 10 DNS-lookup mechanisms (`include`, `a`, `mx`, `ptr`, `exists`, `redirect`; nested includes not followed)
  - **DMARC**: `_dmarc.<domain>` TXT with `v=DMARC1`; read policy (`none`/`quarantine`/`reject`), `rua` presence, `pct`
  - **DKIM**: look up `<selector>._domainkey.<domain>` for common selectors (`default`, `google`, `selector1`, `selector2`, `k1`, `s1`, `s2`)
    plus any supplied; at least one valid `v=DKIM1` record with `p=` is a pass
- Scoring: SPF 35, DKIM 30, DMARC 35; partial credit documented in the code and in `validation.md`
- DNS access behind a `DnsResolver` interface; the real one uses `node:dns/promises`, tests use a fake
- Each fix has a severity (`critical`, `warning`, `info`) and a plain-language explanation

## Out of Scope

- Sending any email, warm-up, inbox-placement testing, blocklist checks
- Following nested SPF includes or exact RFC 7208 lookup counting
- MTA-STS, BIMI, reverse DNS
- Persisting results (audit log arrives in Phase 4)

## Context

- DKIM selectors cannot be discovered from DNS, so "not found" means "not found under the selectors tried".
  The output must say so rather than claim DKIM is absent.
- DNS failures (timeout, SERVFAIL) must be reported as "could not check", never as a pass or a fail.
- Only public DNS records are read; no credentials are involved.
- Domain input is untrusted: reject anything that is not a plain hostname before any lookup.

## Decisions

- Layout: `src/dns/resolver.ts` (interface and real impl), `src/audit/{spf,dmarc,dkim,score}.ts`, `src/tools/auditDomain.ts`
- The audit function is pure over a `DnsResolver`, so it is unit-testable with no network
- Output is structured JSON, also rendered as a short text summary for Claude
