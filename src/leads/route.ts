import type { Condition, Queue, RoutingConfig } from "./config.js";
import type { EnrichmentResult } from "./enrich.js";
import type { Lead } from "./model.js";
import type { ScoreResult } from "./score.js";
import { matchKeywords } from "./text.js";

export interface RouteTraceEntry {
  ruleId: string;
  matched: boolean;
  detail: string;
}

export interface RouteResult {
  queue: Queue;
  label: string;
  ruleId: string;
  /** One sentence: the rule that matched and why each earlier rule did not. */
  reason: string;
  trace: RouteTraceEntry[];
}

interface Ctx {
  lead: Lead;
  domain: string;
  enrichment: EnrichmentResult;
  score: ScoreResult;
  config: RoutingConfig;
}

function evaluate(cond: Condition, ctx: Ctx): { matched: boolean; detail: string } {
  const company = ctx.enrichment.status === "found" ? ctx.enrichment.company : null;
  switch (cond.type) {
    case "domain_in_list": {
      const list = cond.list === "blocked" ? ctx.config.blockedDomains : ctx.config.freeMailDomains;
      const name = cond.list === "blocked" ? "blocked" : "free-mail";
      const matched = list.includes(ctx.domain);
      return { matched, detail: matched ? `${ctx.domain} is on the ${name} list` : `${ctx.domain} is not on the ${name} list` };
    }
    case "segment_hint": {
      if (!company) return { matched: false, detail: `no enrichment data, so no '${cond.hint}' segment hint` };
      const matched = company.segmentHints.includes(cond.hint);
      return { matched, detail: matched ? `${company.name} has segment hint '${cond.hint}'` : `${company.name} has no '${cond.hint}' segment hint` };
    }
    case "message_keywords": {
      const hits = matchKeywords(ctx.lead.message, cond.keywords);
      return { matched: hits.length > 0, detail: hits.length ? `message mentions ${hits.join(", ")}` : "message has none of the keywords" };
    }
    case "enrichment_missing_high_intent": {
      if (company) return { matched: false, detail: "company was found in enrichment" };
      const ok = ctx.score.intentPoints >= cond.minIntentPoints;
      return { matched: ok, detail: `no enrichment data and intent points ${ctx.score.intentPoints} ${ok ? ">=" : "<"} ${cond.minIntentPoints}` };
    }
    case "employees_and_score": {
      if (!company) return { matched: false, detail: "no employee data" };
      const sizeOk = company.employees >= cond.minEmployees;
      const scoreOk = ctx.score.score >= cond.minScore;
      return {
        matched: sizeOk && scoreOk,
        detail: `${company.employees} employees ${sizeOk ? ">=" : "<"} ${cond.minEmployees}; score ${ctx.score.score} ${scoreOk ? ">=" : "<"} ${cond.minScore}`,
      };
    }
    case "employees_min": {
      if (!company) return { matched: false, detail: "no employee data" };
      const ok = company.employees >= cond.minEmployees;
      return { matched: ok, detail: `${company.employees} employees ${ok ? ">=" : "<"} ${cond.minEmployees}` };
    }
    case "always":
      return { matched: true, detail: "default route" };
  }
}

export function routeLead(ctx: Ctx): RouteResult {
  const trace: RouteTraceEntry[] = [];
  for (const rule of ctx.config.routing.rules) {
    const { matched, detail } = evaluate(rule.when, ctx);
    trace.push({ ruleId: rule.id, matched, detail });
    if (matched) {
      const skipped = trace.slice(0, -1).map((t) => `${t.ruleId} (${t.detail})`);
      const reason = `Matched '${rule.id}': ${detail}.` + (skipped.length ? ` Skipped earlier rules: ${skipped.join("; ")}.` : "");
      return { queue: rule.queue, label: rule.label, ruleId: rule.id, reason, trace };
    }
  }
  throw new Error("No routing rule matched; config validation should have required a final 'always' rule.");
}
