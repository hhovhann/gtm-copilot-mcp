import { z } from "zod";
import { appendAudit, type Clock } from "../db/audit.js";
import type { Db } from "../db/open.js";
import { SCENARIO_IDS, type EconomicsConfig } from "../economics/config.js";
import { buildInputs, measureUsage } from "../economics/measure.js";
import { buildReport, renderText } from "../economics/render.js";
import { analyze } from "../economics/sensitivity.js";
import type { SdrConfig } from "../sdr/config.js";

const rate = z.number().min(0).max(1);

export const estimateCostInputSchema = z.object({
  leadsPerMonth: z.number().int().min(10).max(1_000_000).optional(),
  scenarios: z.array(z.enum(SCENARIO_IDS)).min(1).max(3).optional(),
  measuredModel: z.string().min(1).max(100).optional(),
  overrides: z
    .strictObject({
      replyRate: rate.optional(),
      positiveShare: rate.optional(),
      meetingFromPositive: rate.optional(),
      showRate: rate.optional(),
      touchesPerLead: z.number().int().min(1).max(10).optional(),
      reviewedDraftsPerLead: z.number().min(0).max(10).optional(),
      reviewMinutesPerDraft: z.number().min(0).max(60).optional(),
      loadedHourlyRate: z.number().min(0).max(500).optional(),
      passRate: z.number().min(0.01).max(1).optional(),
    })
    .optional(),
});
export type EstimateCostInput = z.infer<typeof estimateCostInputSchema>;

export interface EconomicsDeps {
  db: Db;
  clock: Clock;
  economics: EconomicsConfig;
  sdrConfig: SdrConfig;
}

export function estimateCostTool(deps: EconomicsDeps, input: EstimateCostInput): string[] {
  const { economics, sdrConfig } = deps;
  const wanted = new Set(input.scenarios ?? SCENARIO_IDS);
  const scenarios = economics.scenarios.filter((s) => wanted.has(s.id));

  const measured = measureUsage(deps.db, economics.defaults, { model: input.measuredModel });
  const price = {
    model: sdrConfig.production.model,
    inputPerMTok: sdrConfig.production.pricePerMTok.input,
    outputPerMTok: sdrConfig.production.pricePerMTok.output,
    asOf: sdrConfig.production.asOf,
  };
  const { inputs, tags } = buildInputs(economics.defaults, measured, price, input.leadsPerMonth, input.overrides);
  const { results, cases, recommendation } = analyze(inputs, scenarios);
  const report = buildReport({ inputs, tags, measured, price, results, cases, recommendation });

  appendAudit(deps.db, deps.clock, {
    actor: "mcp",
    action: "tool_call",
    detail: { tool: "estimate_cost_per_meeting", leadsPerMonth: inputs.leadsPerMonth, scenarios: scenarios.length },
  });
  return [renderText(report, inputs, tags), JSON.stringify(report, null, 2)];
}
