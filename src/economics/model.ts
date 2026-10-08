import { ToolError } from "../tools/errors.js";
import type { Scenario } from "./config.js";

export interface Inputs {
  leadsPerMonth: number;
  touchesPerLead: number;
  replyRate: number;
  positiveShare: number;
  meetingFromPositive: number;
  showRate: number;
  reviewedDraftsPerLead: number;
  reviewMinutesPerDraft: number;
  loadedHourlyRate: number;
  passRate: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}

export class EconomicsError extends ToolError {}

export interface ScenarioResult {
  id: Scenario["id"];
  label: string;
  meetingsPerLead: number;
  meetingsPerMonth: number;
  llmPerLead: number;
  reviewPerLead: number;
  variablePerLead: number;
  fixedMonthly: number;
  perMeetingFeeTotal: number;
  monthlyCost: number;
  costPerLead: number;
  costPerMeeting: number;
  /** Dollars per booked meeting, by category. Sums to `costPerMeeting`. */
  breakdownPerMeeting: Record<string, number>;
  largestDriver: { category: string; perMeeting: number; share: number };
  /** cost per meeting = a + f / leadsPerMonth */
  curve: { a: number; f: number };
}

export function costPerDraft(i: Pick<Inputs, "avgInputTokens" | "avgOutputTokens" | "inputPricePerMTok" | "outputPricePerMTok">): number {
  return (i.avgInputTokens * i.inputPricePerMTok + i.avgOutputTokens * i.outputPricePerMTok) / 1_000_000;
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0);

export function evaluate(i: Inputs, s: Scenario): ScenarioResult {
  const meetingsPerLead = i.replyRate * i.positiveShare * i.meetingFromPositive * i.showRate * s.meetingRateMultiplier;
  if (!(meetingsPerLead > 0)) {
    const zero = (["replyRate", "positiveShare", "meetingFromPositive", "showRate"] as const).filter((k) => i[k] === 0);
    throw new EconomicsError(
      `No meetings result from these inputs${zero.length ? ` (${zero.join(", ")} is 0)` : ""}, so cost per meeting is undefined. Use a rate above 0.`,
    );
  }
  const L = i.leadsPerMonth;
  const meetings = L * meetingsPerLead;

  // Blocked drafts still cost tokens, so cost per accepted draft is cost per draft / pass rate.
  const llmPerLead = s.usesOwnLlm ? (i.touchesPerLead * costPerDraft(i)) / i.passRate : 0;
  const reviewPerLead = s.reviewShare * i.reviewedDraftsPerLead * (i.reviewMinutesPerDraft / 60) * i.loadedHourlyRate;
  const otherVariable = sum(s.variablePerLead);
  const variablePerLead = otherVariable + llmPerLead + reviewPerLead;
  const fixedMonthly = sum(s.fixedMonthly);
  const perMeetingFeeTotal = s.perMeetingFee * meetings;
  const monthlyCost = fixedMonthly + L * variablePerLead + perMeetingFeeTotal;

  const breakdownPerMeeting: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.fixedMonthly)) breakdownPerMeeting[`fixed.${k}`] = v / meetings;
  for (const [k, v] of Object.entries(s.variablePerLead)) breakdownPerMeeting[`perLead.${k}`] = (v * L) / meetings;
  breakdownPerMeeting["llm"] = (llmPerLead * L) / meetings;
  breakdownPerMeeting["humanReview"] = (reviewPerLead * L) / meetings;
  breakdownPerMeeting["perMeetingFee"] = s.perMeetingFee;

  const costPerMeeting = monthlyCost / meetings;
  const [category, perMeeting] = Object.entries(breakdownPerMeeting).reduce((best, e) => (e[1] > best[1] ? e : best));

  return {
    id: s.id,
    label: s.label,
    meetingsPerLead,
    meetingsPerMonth: meetings,
    llmPerLead,
    reviewPerLead,
    variablePerLead,
    fixedMonthly,
    perMeetingFeeTotal,
    monthlyCost,
    costPerLead: monthlyCost / L,
    costPerMeeting,
    breakdownPerMeeting,
    largestDriver: { category, perMeeting, share: perMeeting / costPerMeeting },
    curve: { a: variablePerLead / meetingsPerLead + s.perMeetingFee, f: fixedMonthly / meetingsPerLead },
  };
}

export const compare = (i: Inputs, scenarios: Scenario[]): ScenarioResult[] => scenarios.map((s) => evaluate(i, s));

export interface Crossover {
  between: [string, string];
  leadsPerMonth: number;
  cheaperBelow: string;
  cheaperAbove: string;
}

const cpmAt = (r: ScenarioResult, L: number) => r.curve.a + r.curve.f / L;

/** Volume at which two scenarios cost the same per meeting, or null if they never cross at a positive volume. */
export function crossover(x: ScenarioResult, y: ScenarioResult): Crossover | null {
  const da = y.curve.a - x.curve.a;
  if (da === 0) return null;
  const L = (x.curve.f - y.curve.f) / da;
  if (!Number.isFinite(L) || L <= 0) return null;
  const cheaper = (at: number) => (cpmAt(x, at) <= cpmAt(y, at) ? x.id : y.id);
  return { between: [x.id, y.id], leadsPerMonth: L, cheaperBelow: cheaper(L / 2), cheaperAbove: cheaper(L * 2) };
}

export function allCrossovers(results: ScenarioResult[]): Crossover[] {
  const out: Crossover[] = [];
  for (let a = 0; a < results.length; a++) {
    for (let b = a + 1; b < results.length; b++) {
      const c = crossover(results[a]!, results[b]!);
      if (c) out.push(c);
    }
  }
  return out;
}
