import type { RoutingConfig } from "./config.js";
import type { Enricher, EnrichmentResult } from "./enrich.js";
import { deriveDomain, type Lead } from "./model.js";
import { routeLead, type RouteResult } from "./route.js";
import { scoreLead, type ScoreResult } from "./score.js";

export interface LeadDecision {
  domain: string;
  enrichment: EnrichmentResult;
  score: number;
  rawTotal: number;
  scoreBreakdown: ScoreResult["breakdown"];
  route: RouteResult;
}

export async function processLead(lead: Lead, enricher: Enricher, config: RoutingConfig): Promise<LeadDecision> {
  const domain = deriveDomain(lead.email);
  if (!domain) throw new Error("Email has no valid domain.");
  const enrichment = await enricher.enrich(domain);
  const score = scoreLead(lead, enrichment, config);
  const route = routeLead({ lead, domain, enrichment, score, config });
  return { domain, enrichment, score: score.score, rawTotal: score.rawTotal, scoreBreakdown: score.breakdown, route };
}

export function summarizeDecision(d: LeadDecision): string {
  const who = d.enrichment.status === "found"
    ? `${d.enrichment.company.name}, ${d.enrichment.company.employees} employees`
    : "company not found in enrichment";
  const lines = [`Lead at ${d.domain} (${who}) -> ${d.route.label}`, `Score: ${d.score}/100`];
  for (const e of d.scoreBreakdown) lines.push(`  ${e.points >= 0 ? "+" : ""}${e.points} ${e.id}: ${e.reason}`);
  if (d.rawTotal !== d.score) lines.push(`  (raw total ${d.rawTotal}, clamped to ${d.score})`);
  lines.push(`Route: ${d.route.reason}`);
  return lines.join("\n");
}
