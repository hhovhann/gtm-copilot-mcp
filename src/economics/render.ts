import type { Measured, Price, Tag } from "./measure.js";
import { allCrossovers, type Inputs, type ScenarioResult } from "./model.js";
import type { Recommendation, SensitivityCase } from "./sensitivity.js";

export const DISCLAIMER =
  "Every figure is an assumption unless tagged 'measured'. The funnel, cost and vendor numbers are placeholders, not benchmarks, not Krisp's figures and not vendor quotes. Replace them with real data before relying on the result.";

const usd = (n: number, digits = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pad = (s: string, n: number) => s.padEnd(n);
const short = (n: number) => Number(n.toPrecision(4));

export interface Report {
  inputs: Record<string, { value: number; source: Tag }>;
  measured: Measured & { pricedAt: string };
  scenarios: ScenarioResult[];
  crossovers: ReturnType<typeof allCrossovers>;
  sensitivity: SensitivityCase[];
  recommendation: Recommendation;
  disclaimer: string;
}

export function buildReport(args: {
  inputs: Inputs;
  tags: Record<keyof Inputs, Tag>;
  measured: Measured;
  price: Price;
  results: ScenarioResult[];
  cases: SensitivityCase[];
  recommendation: Recommendation;
}): Report {
  const inputs = Object.fromEntries(
    (Object.keys(args.inputs) as (keyof Inputs)[]).map((k) => [k, { value: args.inputs[k], source: args.tags[k] }]),
  );
  return {
    inputs,
    measured: { ...args.measured, pricedAt: `${args.price.model} list rates $${args.price.inputPerMTok} / $${args.price.outputPerMTok} per MTok, as of ${args.price.asOf} (projection)` },
    scenarios: args.results,
    crossovers: allCrossovers(args.results),
    sensitivity: args.cases,
    recommendation: args.recommendation,
    disclaimer: DISCLAIMER,
  };
}

export function renderText(r: Report, inputs: Inputs, tags: Record<keyof Inputs, Tag>): string {
  const lines: string[] = [];
  lines.push(`Cost per meeting at ${inputs.leadsPerMonth.toLocaleString("en-US")} leads per month`, "");
  lines.push([pad("Scenario", 40), pad("Meetings/mo", 12), pad("Monthly cost", 13), pad("Cost/lead", 10), pad("Cost/meeting", 13), "Largest driver"].join(""));
  for (const s of r.scenarios) {
    lines.push([
      pad(s.label, 40), pad(s.meetingsPerMonth.toFixed(1), 12), pad(usd(s.monthlyCost), 13), pad(usd(s.costPerLead, 2), 10),
      pad(usd(s.costPerMeeting), 13), `${s.largestDriver.category} (${(s.largestDriver.share * 100).toFixed(0)}%)`,
    ].join(""));
  }
  lines.push("", "Where the money goes, per meeting:");
  for (const s of r.scenarios) {
    const parts = Object.entries(s.breakdownPerMeeting).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${usd(v)}`);
    lines.push(`  ${s.id}: ${parts.join(", ")}`);
  }
  if (r.crossovers.length) {
    lines.push("", "Crossovers (leads per month at which two options cost the same per meeting):");
    for (const c of r.crossovers) {
      lines.push(`  ${c.between[0]} vs ${c.between[1]}: about ${Math.round(c.leadsPerMonth).toLocaleString("en-US")}; ${c.cheaperBelow} is cheaper below it, ${c.cheaperAbove} above it`);
    }
  }
  lines.push("", `Recommendation: ${r.recommendation.summary}`);
  const m = r.measured;
  lines.push("", m.source === "measured"
    ? `Measured from ${m.drafts} stored drafts (${m.models.join(", ")}): ${m.avgInputTokens.toFixed(0)} input and ${m.avgOutputTokens.toFixed(0)} output tokens per draft, guardrail pass rate ${(m.passRate * 100).toFixed(0)}%. Priced at ${m.pricedAt}.`
    : `Not measured: ${m.reason}. Priced at ${m.pricedAt}.`);
  lines.push("", "Inputs (source):");
  for (const k of Object.keys(inputs) as (keyof Inputs)[]) lines.push(`  ${k} = ${short(inputs[k])} [${tags[k]}]`);
  lines.push("", `Note: ${DISCLAIMER}`);
  return lines.join("\n");
}
