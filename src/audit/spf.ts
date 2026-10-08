import type { DnsResolver } from "../dns/resolver.js";
import { MAX_POINTS, type CheckResult, type Finding } from "./types.js";

const LOOKUP_TERM = /^[+\-~?]?(include:|a(:|\/|$)|mx(:|\/|$)|ptr(:|$)|exists:|redirect=)/i;

export function countSpfLookups(record: string): number {
  return record.split(/\s+/).slice(1).filter((term) => LOOKUP_TERM.test(term)).length;
}

export async function checkSpf(domain: string, dns: DnsResolver): Promise<CheckResult> {
  const max = MAX_POINTS.spf;
  const res = await dns.resolveTxt(domain);
  if (res.status === "error") {
    return { check: "spf", status: "unchecked", points: 0, max, records: [],
      findings: [{ severity: "warning", message: `Could not check SPF: ${res.message}` }] };
  }
  const spf = res.status === "ok" ? res.records.filter((r) => /^v=spf1(\s|$)/i.test(r)) : [];
  const fail = (findings: Finding[], points = 0): CheckResult =>
    ({ check: "spf", status: "fail", points, max, findings, records: spf });

  if (spf.length === 0) {
    return fail([{ severity: "critical", message: "No SPF record found.",
      fix: `Publish a TXT record on ${domain} such as "v=spf1 include:<your-sender> -all".` }]);
  }
  if (spf.length > 1) {
    return fail([{ severity: "critical", message: `${spf.length} SPF records found; receivers treat this as a permanent error.`,
      fix: "Merge them into a single v=spf1 record." }]);
  }

  const record = spf[0]!;
  const findings: Finding[] = [];
  let points: number = max;
  const all = /(?:^|\s)([+\-~?]?)all(?:\s|$)/i.exec(record);

  if (!all) {
    points -= 15;
    findings.push({ severity: "warning", message: "SPF record has no 'all' mechanism.",
      fix: "End the record with '-all' (or '~all' while rolling out)." });
  } else if (all[1] === "+" || all[1] === "") {
    points = 0;
    findings.push({ severity: "critical", message: "SPF ends with '+all', which authorizes every sender.",
      fix: "Replace with '-all' or '~all'." });
  } else if (all[1] === "?") {
    points -= 20;
    findings.push({ severity: "warning", message: "SPF ends with '?all' (neutral), which gives no protection.",
      fix: "Use '~all' or '-all'." });
  } else if (all[1] === "~") {
    points -= 5;
    findings.push({ severity: "info", message: "SPF uses '~all' (softfail).",
      fix: "Move to '-all' once all senders are covered." });
  }

  const lookups = countSpfLookups(record);
  if (lookups > 10) {
    points -= 15;
    findings.push({ severity: "critical", message: `SPF has ${lookups} lookup mechanisms (limit is 10, nested includes not counted).`,
      fix: "Remove unused includes or flatten the record." });
  }

  points = Math.max(0, points);
  const status = findings.some((f) => f.severity !== "info") ? "warn" : "pass";
  return { check: "spf", status: points === 0 ? "fail" : status, points, max, findings, records: spf };
}
