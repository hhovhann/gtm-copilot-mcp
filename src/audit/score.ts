import type { CheckResult, Finding, Severity } from "./types.js";

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Score is earned/possible over checks that ran. Null if nothing could be checked. */
export function computeScore(checks: CheckResult[]): number | null {
  const ran = checks.filter((c) => c.status !== "unchecked");
  const possible = ran.reduce((n, c) => n + c.max, 0);
  if (possible === 0) return null;
  return Math.round((ran.reduce((n, c) => n + c.points, 0) / possible) * 100);
}

export function sortedFixes(checks: CheckResult[]): (Finding & { check: string })[] {
  return checks
    .flatMap((c) => c.findings.map((f) => ({ ...f, check: c.check })))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
