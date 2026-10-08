import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { LEAD_SOURCES } from "./model.js";

export const QUEUES = [
  "disqualify", "developer_sdk", "call_center_specialist", "enterprise_ae", "midmarket_ae", "smb_nurture", "needs_review",
] as const;
export type Queue = (typeof QUEUES)[number];

const id = z.string().regex(/^[a-z0-9_]+$/, "ids use lowercase letters, digits and underscores");
const keywords = z.array(z.string().min(1)).min(1);
const scoreBase = {
  id,
  group: z.enum(["fit", "persona", "intent"]),
  points: z.number().int().min(-100).max(100),
  reason: z.string().min(1),
};

const scoringRule = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("employees_range"), ...scoreBase,
    min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional() })
    .refine((r) => r.min !== undefined || r.max !== undefined, { message: "employees_range needs min and/or max" }),
  z.strictObject({ type: z.literal("industry_in"), ...scoreBase, industries: keywords }),
  z.strictObject({ type: z.literal("country_in"), ...scoreBase, countries: keywords }),
  z.strictObject({ type: z.literal("title_keywords"), ...scoreBase, keywords }),
  z.strictObject({ type: z.literal("source_is"), ...scoreBase, sources: z.array(z.enum(LEAD_SOURCES)).min(1) }),
  z.strictObject({ type: z.literal("message_keywords"), ...scoreBase, keywords }),
]);

const condition = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("domain_in_list"), list: z.enum(["freeMail", "blocked"]) }),
  z.strictObject({ type: z.literal("segment_hint"), hint: z.string().min(1) }),
  z.strictObject({ type: z.literal("message_keywords"), keywords }),
  z.strictObject({ type: z.literal("enrichment_missing_high_intent"), minIntentPoints: z.number().int() }),
  z.strictObject({ type: z.literal("employees_and_score"), minEmployees: z.number().int().nonnegative(), minScore: z.number().int().min(0).max(100) }),
  z.strictObject({ type: z.literal("employees_min"), minEmployees: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal("always") }),
]);

const routingRule = z.strictObject({ id, queue: z.enum(QUEUES), label: z.string().min(1), when: condition });

const domainList = z.array(z.string().min(1).transform((d) => d.toLowerCase()));

export const routingConfigSchema = z
  .strictObject({
    freeMailDomains: domainList,
    blockedDomains: domainList,
    scoring: z.strictObject({ rules: z.array(scoringRule).min(1) }),
    routing: z.strictObject({ rules: z.array(routingRule).min(1) }),
  })
  .superRefine((cfg, ctx) => {
    const dupes = (ids: string[], path: (string | number)[]) =>
      ids.forEach((v, i) => {
        if (ids.indexOf(v) !== i) ctx.addIssue({ code: "custom", path: [...path, i, "id"], message: `duplicate rule id '${v}'` });
      });
    dupes(cfg.scoring.rules.map((r) => r.id), ["scoring", "rules"]);
    dupes(cfg.routing.rules.map((r) => r.id), ["routing", "rules"]);
    const last = cfg.routing.rules.length - 1;
    if (cfg.routing.rules[last]!.when.type !== "always") {
      ctx.addIssue({ code: "custom", path: ["routing", "rules", last], message: "the last routing rule must be type 'always' so every lead gets a route" });
    }
  });

export type RoutingConfig = z.infer<typeof routingConfigSchema>;
export type ScoringRule = RoutingConfig["scoring"]["rules"][number];
export type RoutingRule = RoutingConfig["routing"]["rules"][number];
export type Condition = RoutingRule["when"];

export class ConfigError extends Error {}

export function loadConfig(raw: unknown): RoutingConfig {
  const parsed = routingConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new ConfigError(`Invalid routing config:\n${lines.join("\n")}`);
}

export function loadConfigFile(url: URL | string): RoutingConfig {
  return loadConfig(JSON.parse(readFileSync(url, "utf8")));
}

/** Stable fingerprint of the parsed config, stored with each decision. */
export function hashConfig(config: RoutingConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
