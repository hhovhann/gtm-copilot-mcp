import { readFileSync } from "node:fs";
import { z } from "zod";
import { ToolError } from "../tools/errors.js";

export const SCENARIO_IDS = ["build", "buy", "hybrid"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

const rate = z.number().min(0).max(1);
const money = z.number().min(0);
const assumption = z.literal("assumption");

export const economicsConfigSchema = z
  .strictObject({
    _note: z.string().min(1),
    defaults: z.strictObject({
      source: assumption,
      leadsPerMonth: z.number().int().min(10).max(1_000_000),
      touchesPerLead: z.number().int().min(1).max(10),
      replyRate: rate,
      positiveShare: rate,
      meetingFromPositive: rate,
      showRate: rate,
      reviewedDraftsPerLead: z.number().min(0).max(10),
      reviewMinutesPerDraft: z.number().min(0).max(60),
      loadedHourlyRate: z.number().min(0).max(500),
      passRate: z.number().min(0.01).max(1),
      assumedTokensPerDraft: z.strictObject({ input: z.number().int().min(0), output: z.number().int().min(0) }),
      minMeasuredDrafts: z.number().int().min(1),
    }),
    scenarios: z
      .array(
        z.strictObject({
          id: z.enum(SCENARIO_IDS),
          label: z.string().min(1),
          description: z.string().min(1),
          source: assumption,
          usesOwnLlm: z.boolean(),
          meetingRateMultiplier: z.number().gt(0).max(5),
          reviewShare: rate,
          variablePerLead: z.record(z.string().min(1), money),
          fixedMonthly: z.record(z.string().min(1), money),
          perMeetingFee: money,
        }),
      )
      .min(1),
  })
  .superRefine((cfg, ctx) => {
    cfg.scenarios.forEach((s, i) => {
      if (cfg.scenarios.findIndex((o) => o.id === s.id) !== i) {
        ctx.addIssue({ code: "custom", path: ["scenarios", i, "id"], message: `duplicate scenario id '${s.id}'` });
      }
    });
  });

export type EconomicsConfig = z.infer<typeof economicsConfigSchema>;
export type Scenario = EconomicsConfig["scenarios"][number];
export type Defaults = EconomicsConfig["defaults"];

export class EconomicsConfigError extends ToolError {}

export function loadEconomics(raw: unknown): EconomicsConfig {
  const r = economicsConfigSchema.safeParse(raw);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new EconomicsConfigError(`Invalid economics config:\n${lines.join("\n")}`);
}

export const loadEconomicsFile = (url: URL | string): EconomicsConfig => loadEconomics(JSON.parse(readFileSync(url, "utf8")));
