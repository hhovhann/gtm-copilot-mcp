import type { DnsResolver } from "../dns/resolver.js";
import { MAX_POINTS, type CheckResult, type Finding } from "./types.js";

export function parseTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of record.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) tags[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return tags;
}

export async function checkDmarc(domain: string, dns: DnsResolver): Promise<CheckResult> {
  const max = MAX_POINTS.dmarc;
  const res = await dns.resolveTxt(`_dmarc.${domain}`);
  if (res.status === "error") {
    return { check: "dmarc", status: "unchecked", points: 0, max, records: [],
      findings: [{ severity: "warning", message: `Could not check DMARC: ${res.message}` }] };
  }
  const found = res.status === "ok" ? res.records.filter((r) => /^v=DMARC1\s*;?/i.test(r)) : [];
  if (found.length === 0) {
    return { check: "dmarc", status: "fail", points: 0, max, records: [],
      findings: [{ severity: "critical", message: "No DMARC record found.",
        fix: `Publish a TXT record on _dmarc.${domain}, e.g. "v=DMARC1; p=none; rua=mailto:dmarc@${domain}", then tighten.` }] };
  }

  const tags = parseTags(found[0]!);
  const policy = (tags["p"] ?? "").toLowerCase();
  const findings: Finding[] = [];
  let points: number;

  if (policy === "reject") points = max;
  else if (policy === "quarantine") {
    points = 30;
    findings.push({ severity: "info", message: "DMARC policy is 'quarantine'.",
      fix: "Move to p=reject once legitimate senders are all aligned." });
  }
  else if (policy === "none") {
    points = 15;
    findings.push({ severity: "warning", message: "DMARC policy is 'none' (monitoring only).",
      fix: "Move to p=quarantine, then p=reject, once reports look clean." });
  } else {
    return { check: "dmarc", status: "fail", points: 0, max, records: found,
      findings: [{ severity: "critical", message: "DMARC record has no valid 'p=' policy.",
        fix: "Add p=none, p=quarantine or p=reject." }] };
  }

  if (!tags["rua"]) {
    points -= 5;
    findings.push({ severity: "warning", message: "No 'rua' reporting address, so you cannot see who sends as your domain.",
      fix: `Add rua=mailto:dmarc@${domain}.` });
  }
  const pct = tags["pct"] === undefined ? 100 : Number(tags["pct"]);
  if (policy !== "none" && pct < 100) {
    points -= 5;
    findings.push({ severity: "info", message: `DMARC applies to only ${pct}% of mail.`,
      fix: "Raise pct to 100 once enforcement is stable." });
  }

  points = Math.max(0, points);
  return { check: "dmarc", status: findings.some((f) => f.severity !== "info") ? "warn" : "pass", points, max, findings, records: found };
}
