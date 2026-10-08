import { describe, expect, it } from "vitest";
import { analyze, CASES } from "./sensitivity.js";
import { inp, plain, realEconomics } from "./testing.js";

// build: fixed 1000, 1 per lead.  buy: no fixed, 3 per lead.  They cross at exactly 500 leads/month,
// whatever the funnel rates are, so only a volume change can flip the winner.
const build = plain("build", 1000, 1);
const buy = plain("buy", 0, 3);

describe("analyze: a recommendation that provably flips", () => {
  const a = analyze(inp({ leadsPerMonth: 800 }), [build, buy]);
  it("recommends the cheaper option and says by how much", () => {
    expect(a.recommendation.winner).toBe("build");
    expect(a.recommendation.runnerUp!.id).toBe("buy");
    // cpm(build) = 50 + 50000/800 = 112.5 ; cpm(buy) = 150 ; margin = 37.5 / 150 = 25%
    expect(a.recommendation.marginPct).toBeCloseTo(0.25);
    expect(a.recommendation.costPerMeeting).toBeCloseTo(112.5);
  });
  it("re-runs the whole comparison for every case", () => {
    expect(a.cases).toHaveLength(CASES.length);
    expect(a.cases.map((c) => c.id)).toEqual(CASES.map((c) => c.id));
  });
  it("flips only when volume halves (400 leads is below the 500 crossover) and names that case", () => {
    expect(a.recommendation.flips).toEqual([{ caseId: "leads_x0.5", label: "leads per month x0.5", newWinner: "buy" }]);
    expect(a.recommendation.robustCases).toBe(CASES.length - 1);
    expect(a.recommendation.summary).toMatch(/loses when: leads per month x0.5 \(buy\)/);
    expect(a.recommendation.summary).toMatch(/9 of 10 sensitivity cases/);
  });
});

describe("analyze: a recommendation that cannot flip", () => {
  const a = analyze(inp(), [plain("build", 0, 1), plain("buy", 0, 3)]);
  it("reports full robustness and no flips", () => {
    expect(a.recommendation.winner).toBe("build");
    expect(a.recommendation.flips).toEqual([]);
    expect(a.recommendation.robustCases).toBe(a.recommendation.totalCases);
    expect(a.recommendation.summary).not.toMatch(/loses when/);
  });
});

describe("analyze: honesty about small margins and single scenarios", () => {
  it("warns that a margin under 10% means the options are roughly equal", () => {
    const a = analyze(inp(), [plain("build", 0, 1), plain("buy", 0, 1.05)]);
    expect(a.recommendation.marginPct!).toBeLessThan(0.1);
    expect(a.recommendation.summary).toMatch(/roughly equal/);
  });
  it("does not rank a single scenario against nothing", () => {
    const a = analyze(inp(), [build]);
    expect(a.cases).toEqual([]);
    expect(a.recommendation.runnerUp).toBeNull();
    expect(a.recommendation.marginPct).toBeNull();
    expect(a.recommendation.summary).toMatch(/Only one scenario/);
  });
});

describe("analyze: sensitivity stays inside valid ranges", () => {
  it("clamps pass rate, reply rate and volume instead of producing nonsense", () => {
    const extreme = inp({ passRate: 0.1, replyRate: 0.9, leadsPerMonth: 600_000 });
    const a = analyze(extreme, realEconomics().scenarios);
    expect(a.cases).toHaveLength(CASES.length);
    expect(a.results.every((r) => Number.isFinite(r.costPerMeeting))).toBe(true);
    for (const c of CASES) {
      const i = c.apply(extreme);
      expect(i.passRate).toBeGreaterThanOrEqual(0.01);
      expect(i.passRate).toBeLessThanOrEqual(1);
      expect(i.replyRate).toBeLessThanOrEqual(1);
      expect(i.leadsPerMonth).toBeLessThanOrEqual(1_000_000);
    }
  });
});
