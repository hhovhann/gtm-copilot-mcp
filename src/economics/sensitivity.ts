import type { Scenario } from "./config.js";
import { compare, type Inputs, type ScenarioResult } from "./model.js";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface Case {
  id: string;
  label: string;
  apply: (i: Inputs) => Inputs;
}

export const CASES: Case[] = [
  { id: "reply_x0.5", label: "reply rate x0.5", apply: (i) => ({ ...i, replyRate: i.replyRate * 0.5 }) },
  { id: "reply_x1.5", label: "reply rate x1.5", apply: (i) => ({ ...i, replyRate: clamp(i.replyRate * 1.5, 0, 1) }) },
  { id: "review_x0.5", label: "review minutes x0.5", apply: (i) => ({ ...i, reviewMinutesPerDraft: i.reviewMinutesPerDraft * 0.5 }) },
  { id: "review_x1.5", label: "review minutes x1.5", apply: (i) => ({ ...i, reviewMinutesPerDraft: i.reviewMinutesPerDraft * 1.5 }) },
  { id: "leads_x0.5", label: "leads per month x0.5", apply: (i) => ({ ...i, leadsPerMonth: clamp(Math.round(i.leadsPerMonth * 0.5), 10, 1_000_000) }) },
  { id: "leads_x2", label: "leads per month x2", apply: (i) => ({ ...i, leadsPerMonth: clamp(Math.round(i.leadsPerMonth * 2), 10, 1_000_000) }) },
  { id: "pass_-0.2", label: "pass rate -0.2", apply: (i) => ({ ...i, passRate: clamp(i.passRate - 0.2, 0.01, 1) }) },
  { id: "pass_+0.1", label: "pass rate +0.1", apply: (i) => ({ ...i, passRate: clamp(i.passRate + 0.1, 0.01, 1) }) },
  { id: "hourly_x0.5", label: "loaded hourly rate x0.5", apply: (i) => ({ ...i, loadedHourlyRate: i.loadedHourlyRate * 0.5 }) },
  { id: "hourly_x1.5", label: "loaded hourly rate x1.5", apply: (i) => ({ ...i, loadedHourlyRate: i.loadedHourlyRate * 1.5 }) },
];

export interface SensitivityCase {
  id: string;
  label: string;
  winner: string;
  flips: boolean;
}

export interface Recommendation {
  winner: string;
  label: string;
  costPerMeeting: number;
  runnerUp: { id: string; label: string; costPerMeeting: number } | null;
  /** How far below the runner-up the winner is, as a fraction of the runner-up's cost. */
  marginPct: number | null;
  robustCases: number;
  totalCases: number;
  flips: { caseId: string; label: string; newWinner: string }[];
  summary: string;
}

const cheapest = (rs: ScenarioResult[]) => [...rs].sort((a, b) => a.costPerMeeting - b.costPerMeeting);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function analyze(inputs: Inputs, scenarios: Scenario[]): { results: ScenarioResult[]; cases: SensitivityCase[]; recommendation: Recommendation } {
  const results = compare(inputs, scenarios);
  const ranked = cheapest(results);
  const winner = ranked[0]!;
  const runner = ranked[1] ?? null;

  const cases: SensitivityCase[] = scenarios.length < 2 ? [] : CASES.map((c) => {
    const w = cheapest(compare(c.apply(inputs), scenarios))[0]!;
    return { id: c.id, label: c.label, winner: w.id, flips: w.id !== winner.id };
  });
  const flips = cases.filter((c) => c.flips).map((c) => ({ caseId: c.id, label: c.label, newWinner: c.winner }));
  const robustCases = cases.length - flips.length;
  const marginPct = runner ? (runner.costPerMeeting - winner.costPerMeeting) / runner.costPerMeeting : null;

  const parts = [`Cheapest at these inputs: ${winner.label} at ${money(winner.costPerMeeting)} per meeting`];
  if (runner && marginPct !== null) parts[0] += `, ${(marginPct * 100).toFixed(0)}% below ${runner.label} (${money(runner.costPerMeeting)})`;
  parts[0] += ".";
  if (cases.length) {
    parts.push(`It stays cheapest in ${robustCases} of ${cases.length} sensitivity cases.`);
    if (flips.length) parts.push(`It loses when: ${flips.map((f) => `${f.label} (${f.newWinner})`).join(", ")}.`);
    if (marginPct !== null && marginPct < 0.1) parts.push("The margin is small: treat these options as roughly equal on cost and decide on risk, control and speed.");
  } else {
    parts.push("Only one scenario was compared, so there is nothing to rank it against.");
  }

  return {
    results,
    cases,
    recommendation: {
      winner: winner.id,
      label: winner.label,
      costPerMeeting: winner.costPerMeeting,
      runnerUp: runner ? { id: runner.id, label: runner.label, costPerMeeting: runner.costPerMeeting } : null,
      marginPct,
      robustCases,
      totalCases: cases.length,
      flips,
      summary: parts.join(" "),
    },
  };
}
