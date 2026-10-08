import { readFileSync } from "node:fs";
import { z } from "zod";
import { QUEUES, type Queue } from "../leads/config.js";

const regexString = z.string().min(1).refine(
  (p) => { try { new RegExp(p, "i"); return true; } catch { return false; } },
  { message: "must be a valid regular expression" },
);
const words = z.array(z.string().min(1));
const posInt = z.number().int().positive();

export const sdrConfigSchema = z.strictObject({
  draftableQueues: z.array(z.enum(QUEUES)).min(1),
  limits: z.strictObject({
    maxDraftsPerLead: posInt, maxDraftsPer24h: posInt, subjectMax: posInt, bodyMin: posInt, bodyMax: posInt, messageMaxChars: posInt,
  }),
  local: z.strictObject({
    baseUrl: z.url(), model: z.string().min(1), temperature: z.number().min(0).max(2), timeoutMs: posInt, maxTokens: posInt,
  }),
  production: z.strictObject({
    provider: z.literal("anthropic"),
    model: z.string().min(1),
    pricePerMTok: z.strictObject({ input: z.number().nonnegative(), output: z.number().nonnegative() }),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  injectionPatterns: z.array(regexString).min(1),
  neverClaim: words,
  needsSource: z.strictObject({ terms: words, superlatives: words }),
  leakTerms: words,
  footer: z.strictObject({ senderName: z.string().min(1), postalAddress: z.string().min(1), unsubscribeLine: z.string().min(1) }),
});
export type SdrConfig = z.infer<typeof sdrConfigSchema>;

export const factSchema = z.strictObject({
  id: z.string().regex(/^F-[A-Z0-9-]+$/, "fact ids look like F-NC-01"),
  text: z.string().min(1),
  category: z.string().min(1),
  allowedQueues: z.array(z.enum(QUEUES)).min(1),
  source: z.string().min(1),
  status: z.enum(["pilot-placeholder", "approved"]),
});
export type Fact = z.infer<typeof factSchema>;

const factsFileSchema = z.strictObject({ _note: z.string(), facts: z.array(factSchema).min(1) }).superRefine((f, ctx) => {
  f.facts.forEach((fact, i) => {
    if (f.facts.findIndex((o) => o.id === fact.id) !== i) {
      ctx.addIssue({ code: "custom", path: ["facts", i, "id"], message: `duplicate fact id '${fact.id}'` });
    }
  });
});

const suppressionFileSchema = z.strictObject({
  _note: z.string(),
  entries: z.array(z.strictObject({
    type: z.enum(["email", "domain"]),
    value: z.string().min(1).transform((v) => v.trim().toLowerCase()),
    reason: z.string().min(1),
  })),
});
export type SuppressionEntry = z.infer<typeof suppressionFileSchema>["entries"][number];

export class SdrConfigError extends Error {}

function parse<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new SdrConfigError(`Invalid ${what}:\n${lines.join("\n")}`);
}

const readJson = (url: URL | string): unknown => JSON.parse(readFileSync(url, "utf8"));

export const loadSdrConfig = (raw: unknown): SdrConfig => parse(sdrConfigSchema, raw, "SDR config");
export const loadSdrConfigFile = (url: URL | string): SdrConfig => loadSdrConfig(readJson(url));
export const loadFacts = (raw: unknown): Fact[] => parse(factsFileSchema, raw, "approved facts").facts;
export const loadFactsFile = (url: URL | string): Fact[] => loadFacts(readJson(url));
export const loadSuppression = (raw: unknown): SuppressionEntry[] => parse(suppressionFileSchema, raw, "suppression list").entries;
export const loadSuppressionFile = (url: URL | string): SuppressionEntry[] => loadSuppression(readJson(url));

export function factsForQueue(facts: Fact[], queue: Queue): Fact[] {
  return facts.filter((f) => f.allowedQueues.includes(queue));
}

export function isSuppressed(entries: SuppressionEntry[], email: string, domain: string): SuppressionEntry | null {
  const e = email.trim().toLowerCase();
  const d = domain.trim().toLowerCase();
  return entries.find((x) => (x.type === "email" ? x.value === e : x.value === d)) ?? null;
}
