import type { DnsResolver } from "../dns/resolver.js";
import { MAX_POINTS, type CheckResult, type Finding } from "./types.js";
import { parseTags } from "./dmarc.js";

export const DEFAULT_DKIM_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "s1", "s2"];

export async function checkDkim(domain: string, dns: DnsResolver, extraSelectors: string[] = []): Promise<CheckResult> {
  const max = MAX_POINTS.dkim;
  const selectors = [...new Set([...DEFAULT_DKIM_SELECTORS, ...extraSelectors])];
  const results = await Promise.all(
    selectors.map(async (s) => ({ selector: s, res: await dns.resolveTxt(`${s}._domainkey.${domain}`) })),
  );

  const valid: string[] = [];
  const revoked: string[] = [];
  const records: string[] = [];
  let errors = 0;
  for (const { selector, res } of results) {
    if (res.status === "error") { errors++; continue; }
    if (res.status === "none") continue;
    for (const rec of res.records) {
      if (!/v=DKIM1/i.test(rec)) continue;
      records.push(`${selector}: ${rec}`);
      (parseTags(rec)["p"] ? valid : revoked).push(selector);
    }
  }

  if (valid.length > 0) {
    const findings: Finding[] = revoked.length
      ? [{ severity: "info", message: `Selectors with an empty key (revoked): ${revoked.join(", ")}.` }]
      : [];
    return { check: "dkim", status: "pass", points: max, max, findings, records };
  }
  if (errors === selectors.length) {
    return { check: "dkim", status: "unchecked", points: 0, max, records: [],
      findings: [{ severity: "warning", message: "Could not check DKIM: every selector lookup failed." }] };
  }
  const findings: Finding[] = [{
    severity: "warning",
    message: `No DKIM key found under the selectors tried (${selectors.join(", ")}). Selectors cannot be discovered from DNS, so DKIM may still exist under another name.`,
    fix: "Pass your sender's selector via dkimSelectors, or enable DKIM signing in your sending platform.",
  }];
  if (revoked.length) findings.push({ severity: "critical", message: `Key is empty (revoked) for: ${revoked.join(", ")}.`, fix: "Publish a valid public key." });
  return { check: "dkim", status: "fail", points: 0, max, findings, records };
}
