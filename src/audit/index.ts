import type { DnsResolver } from "../dns/resolver.js";
import { checkDkim } from "./dkim.js";
import { checkDmarc } from "./dmarc.js";
import { computeScore, sortedFixes } from "./score.js";
import { checkSpf } from "./spf.js";
import type { CheckResult, Finding } from "./types.js";

export interface AuditReport {
  domain: string;
  score: number | null;
  checks: CheckResult[];
  fixes: (Finding & { check: string })[];
}

export async function auditDomain(
  domain: string,
  dns: DnsResolver,
  options: { dkimSelectors?: string[] } = {},
): Promise<AuditReport> {
  const checks = await Promise.all([
    checkSpf(domain, dns),
    checkDkim(domain, dns, options.dkimSelectors),
    checkDmarc(domain, dns),
  ]);
  return { domain, score: computeScore(checks), checks, fixes: sortedFixes(checks) };
}

export function summarize(report: AuditReport): string {
  const lines = [`Deliverability audit for ${report.domain}: ${report.score === null ? "score unavailable (DNS lookups failed)" : `${report.score}/100`}`];
  for (const c of report.checks) lines.push(`- ${c.check.toUpperCase()}: ${c.status} (${c.points}/${c.max})`);
  if (report.fixes.length) {
    lines.push("Fixes, most important first:");
    for (const f of report.fixes) lines.push(`- [${f.severity}] ${f.check.toUpperCase()}: ${f.message}${f.fix ? ` Fix: ${f.fix}` : ""}`);
  }
  return lines.join("\n");
}
