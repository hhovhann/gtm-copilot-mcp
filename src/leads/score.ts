import type { RoutingConfig, ScoringRule } from "./config.js";
import type { EnrichmentResult } from "./enrich.js";
import { matchKeywords } from "./text.js";
import type { Lead } from "./model.js";

export interface ScoreEntry {
  id: string;
  group: "fit" | "persona" | "intent";
  points: number;
  reason: string;
}

export interface ScoreResult {
  score: number;
  /** Sum of breakdown points before clamping to 0-100. */
  rawTotal: number;
  breakdown: ScoreEntry[];
  intentPoints: number;
}

/** Returns extra detail when the rule matches, or null when it does not. */
function matchRule(rule: ScoringRule, lead: Lead, enrichment: EnrichmentResult): string | null {
  const company = enrichment.status === "found" ? enrichment.company : null;
  switch (rule.type) {
    case "employees_range":
      if (!company) return null;
      return (rule.min === undefined || company.employees >= rule.min) &&
        (rule.max === undefined || company.employees <= rule.max)
        ? `${company.employees} employees`
        : null;
    case "industry_in":
      return company && rule.industries.includes(company.industry) ? company.industry : null;
    case "country_in":
      return company && rule.countries.includes(company.country) ? company.country : null;
    case "title_keywords": {
      const hits = matchKeywords(lead.title, rule.keywords);
      return hits.length ? `title matched: ${hits.join(", ")}` : null;
    }
    case "source_is":
      return rule.sources.includes(lead.source) ? `source: ${lead.source}` : null;
    case "message_keywords": {
      const hits = matchKeywords(lead.message, rule.keywords);
      return hits.length ? `message matched: ${hits.join(", ")}` : null;
    }
  }
}

export function scoreLead(lead: Lead, enrichment: EnrichmentResult, config: RoutingConfig): ScoreResult {
  const breakdown: ScoreEntry[] = [];
  for (const rule of config.scoring.rules) {
    const detail = matchRule(rule, lead, enrichment);
    if (detail !== null) {
      breakdown.push({ id: rule.id, group: rule.group, points: rule.points, reason: `${rule.reason} (${detail})` });
    }
  }
  const rawTotal = breakdown.reduce((n, e) => n + e.points, 0);
  const intentPoints = breakdown.filter((e) => e.group === "intent").reduce((n, e) => n + e.points, 0);
  return { score: Math.min(100, Math.max(0, rawTotal)), rawTotal, breakdown, intentPoints };
}
