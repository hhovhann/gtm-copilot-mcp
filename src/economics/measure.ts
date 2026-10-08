import type { Db } from "../db/open.js";
import type { Defaults } from "./config.js";
import type { Inputs } from "./model.js";

export type Tag = "measured" | "assumption" | "override";

export interface Measured {
  source: "measured" | "assumption";
  drafts: number;
  models: string[];
  avgInputTokens: number;
  avgOutputTokens: number;
  passRate: number;
  /** Why assumed values were used instead of measured ones. */
  reason?: string;
}

/** Usage from stored drafts written by a model. The template drafter is excluded because it uses no tokens. */
export function measureUsage(db: Db, defaults: Defaults, opts: { model?: string } = {}): Measured {
  const where = opts.model ? "WHERE drafter != 'template' AND model = ?" : "WHERE drafter != 'template'";
  const params = opts.model ? [opts.model] : [];
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, AVG(input_tokens) AS avg_in, AVG(output_tokens) AS avg_out,
              SUM(CASE WHEN status != 'blocked' THEN 1 ELSE 0 END) AS ok FROM drafts ${where}`,
    )
    .get(...params) as { n: number; avg_in: number | null; avg_out: number | null; ok: number | null };
  const models = (db.prepare(`SELECT DISTINCT model FROM drafts ${where} ORDER BY model`).all(...params) as { model: string }[]).map((m) => m.model);

  if (row.n < defaults.minMeasuredDrafts) {
    return {
      source: "assumption",
      drafts: row.n,
      models,
      avgInputTokens: defaults.assumedTokensPerDraft.input,
      avgOutputTokens: defaults.assumedTokensPerDraft.output,
      passRate: defaults.passRate,
      reason: `only ${row.n} model draft${row.n === 1 ? "" : "s"}${opts.model ? ` for ${opts.model}` : ""} stored (minimum ${defaults.minMeasuredDrafts}), so assumed values are used`,
    };
  }
  return {
    source: "measured",
    drafts: row.n,
    models,
    avgInputTokens: row.avg_in ?? 0,
    avgOutputTokens: row.avg_out ?? 0,
    passRate: Math.max(0.01, (row.ok ?? 0) / row.n),
  };
}

export interface Overrides {
  replyRate?: number;
  positiveShare?: number;
  meetingFromPositive?: number;
  showRate?: number;
  touchesPerLead?: number;
  reviewedDraftsPerLead?: number;
  reviewMinutesPerDraft?: number;
  loadedHourlyRate?: number;
  passRate?: number;
}

export interface Price {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  asOf: string;
}

/** Merge defaults, measured usage and per-call overrides. Every input records where it came from. */
export function buildInputs(
  defaults: Defaults,
  measured: Measured,
  price: Price,
  leadsPerMonth: number | undefined,
  overrides: Overrides = {},
): { inputs: Inputs; tags: Record<keyof Inputs, Tag> } {
  const pick = <K extends keyof Overrides>(key: K, fallback: number): [number, Tag] =>
    overrides[key] !== undefined ? [overrides[key] as number, "override"] : [fallback, "assumption"];

  const [replyRate, tReply] = pick("replyRate", defaults.replyRate);
  const [positiveShare, tPos] = pick("positiveShare", defaults.positiveShare);
  const [meetingFromPositive, tMeet] = pick("meetingFromPositive", defaults.meetingFromPositive);
  const [showRate, tShow] = pick("showRate", defaults.showRate);
  const [touchesPerLead, tTouch] = pick("touchesPerLead", defaults.touchesPerLead);
  const [reviewedDraftsPerLead, tRev] = pick("reviewedDraftsPerLead", defaults.reviewedDraftsPerLead);
  const [reviewMinutesPerDraft, tMin] = pick("reviewMinutesPerDraft", defaults.reviewMinutesPerDraft);
  const [loadedHourlyRate, tRate] = pick("loadedHourlyRate", defaults.loadedHourlyRate);
  const passOverridden = overrides.passRate !== undefined;
  const dataTag: Tag = measured.source;

  return {
    inputs: {
      leadsPerMonth: leadsPerMonth ?? defaults.leadsPerMonth,
      touchesPerLead, replyRate, positiveShare, meetingFromPositive, showRate,
      reviewedDraftsPerLead, reviewMinutesPerDraft, loadedHourlyRate,
      passRate: passOverridden ? (overrides.passRate as number) : measured.passRate,
      avgInputTokens: measured.avgInputTokens,
      avgOutputTokens: measured.avgOutputTokens,
      inputPricePerMTok: price.inputPerMTok,
      outputPricePerMTok: price.outputPerMTok,
    },
    tags: {
      leadsPerMonth: leadsPerMonth !== undefined ? "override" : "assumption",
      touchesPerLead: tTouch, replyRate: tReply, positiveShare: tPos, meetingFromPositive: tMeet, showRate: tShow,
      reviewedDraftsPerLead: tRev, reviewMinutesPerDraft: tMin, loadedHourlyRate: tRate,
      passRate: passOverridden ? "override" : dataTag,
      avgInputTokens: dataTag,
      avgOutputTokens: dataTag,
      inputPricePerMTok: "assumption",
      outputPricePerMTok: "assumption",
    },
  };
}
