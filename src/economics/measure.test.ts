import { describe, expect, it } from "vitest";
import { insertDraft } from "../db/drafts.js";
import { makeApp } from "../db/testing.js";
import { buildInputs, measureUsage } from "./measure.js";
import { realEconomics } from "./testing.js";

const defaults = realEconomics().defaults;
const PRICE = { model: "claude-sonnet-5-5", inputPerMTok: 2, outputPerMTok: 10, asOf: "2026-10-06" };

async function seeded(rows: { n: number; drafter: string; model: string; status?: "pending_review" | "blocked"; inTok: number; outTok: number }[]) {
  const app = makeApp();
  const res = await app.post({ email: "vp@orbitbank.example", firstName: "Vera", lastName: "Vance", source: "demo_request" });
  const leadId = ((await res.json()) as { leadId: number }).leadId;
  for (const r of rows) {
    for (let i = 0; i < r.n; i++) {
      insertDraft(app.db, {
        leadId, createdAt: "2026-10-08T12:00:00.000Z", status: r.status ?? "pending_review", subject: "s", body: "b", claims: [],
        guardrails: { status: r.status === "blocked" ? "blocked" : "passed", checks: [], notChecked: [] }, contentHash: "h", drafter: r.drafter, model: r.model,
        promptVersion: "p", inputTokens: r.inTok, outputTokens: r.outTok, estCostUsd: 0,
      });
    }
  }
  return app.db;
}

describe("measureUsage", () => {
  it("measures average tokens and the guardrail pass rate from model drafts", async () => {
    const db = await seeded([
      { n: 9, drafter: "local", model: "llama", inTok: 400, outTok: 100 },
      { n: 3, drafter: "local", model: "llama", status: "blocked", inTok: 400, outTok: 100 },
    ]);
    expect(measureUsage(db, defaults)).toMatchObject({ source: "measured", drafts: 12, models: ["llama"], avgInputTokens: 400, avgOutputTokens: 100, passRate: 0.75 });
  });
  it("blocked drafts lower the pass rate but still count their tokens", async () => {
    const db = await seeded([
      { n: 6, drafter: "local", model: "m", inTok: 100, outTok: 10 },
      { n: 6, drafter: "local", model: "m", status: "blocked", inTok: 300, outTok: 30 },
    ]);
    const m = measureUsage(db, defaults);
    expect(m.passRate).toBe(0.5);
    expect(m.avgInputTokens).toBe(200);
    expect(m.avgOutputTokens).toBe(20);
  });
  it("excludes the template drafter, which uses no tokens", async () => {
    const db = await seeded([
      { n: 20, drafter: "template", model: "template-v1", inTok: 0, outTok: 0 },
      { n: 2, drafter: "local", model: "m", inTok: 500, outTok: 50 },
    ]);
    const m = measureUsage(db, defaults);
    expect(m.drafts).toBe(2);
    expect(m.source).toBe("assumption");
  });
  it("excludes template drafts even when the model filter names the template model", async () => {
    const db = await seeded([{ n: 20, drafter: "template", model: "template-v1", inTok: 0, outTok: 0 }]);
    const m = measureUsage(db, defaults, { model: "template-v1" });
    expect(m.source).toBe("assumption");
    expect(m.drafts).toBe(0);
    expect(m.avgInputTokens).toBe(defaults.assumedTokensPerDraft.input); // not a measured average of zero
  });
  it("falls back to assumed values below the minimum, and says why", async () => {
    const db = await seeded([{ n: 9, drafter: "local", model: "m", inTok: 999, outTok: 99 }]);
    const m = measureUsage(db, defaults);
    expect(m).toMatchObject({ source: "assumption", drafts: 9, passRate: defaults.passRate, avgInputTokens: defaults.assumedTokensPerDraft.input, avgOutputTokens: defaults.assumedTokensPerDraft.output });
    expect(m.reason).toMatch(/only 9 model drafts .*minimum 10/);
  });
  it("falls back on an empty database", async () => {
    const m = measureUsage((await seeded([])), defaults);
    expect(m).toMatchObject({ source: "assumption", drafts: 0 });
    expect(m.reason).toMatch(/only 0 model drafts/);
  });
  it("narrows to one model on request, and names the model when it falls back", async () => {
    const db = await seeded([
      { n: 12, drafter: "local", model: "A", inTok: 400, outTok: 100 },
      { n: 5, drafter: "local", model: "B", inTok: 800, outTok: 200 },
    ]);
    expect(measureUsage(db, defaults, { model: "A" })).toMatchObject({ source: "measured", drafts: 12, avgInputTokens: 400 });
    const b = measureUsage(db, defaults, { model: "B" });
    expect(b.source).toBe("assumption");
    expect(b.reason).toContain("for B");
    expect(measureUsage(db, defaults).drafts).toBe(17);
  });
  it("never reports a pass rate of zero, which would divide by zero downstream", async () => {
    const db = await seeded([{ n: 10, drafter: "local", model: "m", status: "blocked", inTok: 100, outTok: 10 }]);
    expect(measureUsage(db, defaults).passRate).toBe(0.01);
  });
});

describe("buildInputs: where every number came from", () => {
  const measured = { source: "measured" as const, drafts: 12, models: ["m"], avgInputTokens: 400, avgOutputTokens: 100, passRate: 0.75 };
  const assumed = { ...measured, source: "assumption" as const, reason: "x" };

  it("tags measured usage as measured and everything else as an assumption", () => {
    const { inputs, tags } = buildInputs(defaults, measured, PRICE, undefined);
    expect(inputs).toMatchObject({ passRate: 0.75, avgInputTokens: 400, avgOutputTokens: 100, replyRate: defaults.replyRate, leadsPerMonth: 2000 });
    expect(tags).toMatchObject({ passRate: "measured", avgInputTokens: "measured", avgOutputTokens: "measured", replyRate: "assumption", leadsPerMonth: "assumption", inputPricePerMTok: "assumption" });
  });
  it("tags fallback usage as an assumption", () => {
    expect(buildInputs(defaults, assumed, PRICE, undefined).tags.passRate).toBe("assumption");
  });
  it("applies and tags overrides, including pass rate over a measured one", () => {
    const { inputs, tags } = buildInputs(defaults, measured, PRICE, 5000, { replyRate: 0.08, passRate: 0.9, reviewMinutesPerDraft: 3 });
    expect(inputs).toMatchObject({ leadsPerMonth: 5000, replyRate: 0.08, passRate: 0.9, reviewMinutesPerDraft: 3 });
    expect(tags).toMatchObject({ leadsPerMonth: "override", replyRate: "override", passRate: "override", reviewMinutesPerDraft: "override", showRate: "assumption" });
  });
  it("carries the production price into the inputs", () => {
    expect(buildInputs(defaults, measured, PRICE, undefined).inputs).toMatchObject({ inputPricePerMTok: 2, outputPricePerMTok: 10 });
  });
});
