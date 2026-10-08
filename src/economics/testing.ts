import { loadEconomicsFile, type Scenario } from "./config.js";
import type { Inputs } from "./model.js";

export const realEconomics = () => loadEconomicsFile(new URL("../../config/economics.json", import.meta.url));

/** Round numbers chosen so every expected value can be checked by hand. */
export const inp = (over: Partial<Inputs> = {}): Inputs => ({
  leadsPerMonth: 1000, touchesPerLead: 4, replyRate: 0.1, positiveShare: 0.5, meetingFromPositive: 0.5, showRate: 0.8,
  reviewedDraftsPerLead: 1, reviewMinutesPerDraft: 6, loadedHourlyRate: 50, passRate: 0.5,
  avgInputTokens: 1000, avgOutputTokens: 200, inputPricePerMTok: 2, outputPricePerMTok: 10, ...over,
});

export const sc = (over: Partial<Scenario> = {}): Scenario => ({
  id: "build", label: "S", description: "d", source: "assumption", usesOwnLlm: true, meetingRateMultiplier: 1, reviewShare: 1,
  variablePerLead: { enrich: 0.5 }, fixedMonthly: { a: 1000, b: 500 }, perMeetingFee: 10, ...over,
});

/** A scenario with only fixed and per-lead cost, no LLM, no review: isolates the crossover maths. */
export const plain = (id: Scenario["id"], fixed: number, perLead: number): Scenario =>
  sc({ id, label: id, usesOwnLlm: false, reviewShare: 0, variablePerLead: { v: perLead }, fixedMonthly: fixed ? { f: fixed } : {}, perMeetingFee: 0 });
