export type Severity = "critical" | "warning" | "info";

export interface Finding {
  severity: Severity;
  message: string;
  fix?: string;
}

export interface CheckResult {
  check: "spf" | "dkim" | "dmarc";
  /** "unchecked" means DNS failed; it is excluded from the score. */
  status: "pass" | "warn" | "fail" | "unchecked";
  points: number;
  max: number;
  findings: Finding[];
  records: string[];
}

export const MAX_POINTS = { spf: 35, dkim: 30, dmarc: 35 } as const;
