import { describe, expect, it } from "vitest";
import { allCrossovers, compare, costPerDraft, crossover, evaluate, EconomicsError } from "./model.js";
import { inp, plain, realEconomics, sc } from "./testing.js";

describe("evaluate: a worked example, checked by hand", () => {
  // meetings/lead = 0.1 x 0.5 x 0.5 x 0.8 = 0.02 -> 20 meetings from 1000 leads
  // cost/draft = (1000x2 + 200x10)/1e6 = 0.004; LLM/lead = 4 x 0.004 / 0.5 = 0.032
  // review/lead = 1 x 6/60 x 50 = 5; variable/lead = 0.5 + 0.032 + 5 = 5.532
  // monthly = 1500 fixed + 1000 x 5.532 + 10 x 20 = 7232; per meeting = 361.6
  const r = evaluate(inp(), sc());
  it("computes meetings", () => {
    expect(r.meetingsPerLead).toBeCloseTo(0.02);
    expect(r.meetingsPerMonth).toBeCloseTo(20);
  });
  it("computes each cost component", () => {
    expect(costPerDraft(inp())).toBeCloseTo(0.004);
    expect(r.llmPerLead).toBeCloseTo(0.032);
    expect(r.reviewPerLead).toBeCloseTo(5);
    expect(r.variablePerLead).toBeCloseTo(5.532);
    expect(r.fixedMonthly).toBe(1500);
    expect(r.perMeetingFeeTotal).toBeCloseTo(200);
  });
  it("computes monthly cost, cost per lead and cost per meeting", () => {
    expect(r.monthlyCost).toBeCloseTo(7232);
    expect(r.costPerLead).toBeCloseTo(7.232);
    expect(r.costPerMeeting).toBeCloseTo(361.6);
  });
  it("splits cost per meeting by category, and the parts sum to the whole", () => {
    expect(r.breakdownPerMeeting["fixed.a"]).toBeCloseTo(50);
    expect(r.breakdownPerMeeting["fixed.b"]).toBeCloseTo(25);
    expect(r.breakdownPerMeeting["perLead.enrich"]).toBeCloseTo(25);
    expect(r.breakdownPerMeeting["perMeetingFee"]).toBe(10);
    expect(r.breakdownPerMeeting["llm"]).toBeCloseTo(1.6);
    expect(r.breakdownPerMeeting["humanReview"]).toBeCloseTo(250);
    expect(Object.values(r.breakdownPerMeeting).reduce((a, b) => a + b, 0)).toBeCloseTo(r.costPerMeeting);
  });
  it("names the largest driver by computing it", () => {
    expect(r.largestDriver.category).toBe("humanReview");
    expect(r.largestDriver.share).toBeCloseTo(250 / 361.6);
    const noReview = evaluate(inp(), sc({ reviewShare: 0 }));
    expect(noReview.largestDriver.category).toBe("fixed.a");
  });
});

describe("evaluate: each lever moves the result the way the formula says", () => {
  const base = evaluate(inp(), sc());
  it("a lower pass rate raises LLM cost in proportion, because blocked drafts still cost tokens", () => {
    expect(evaluate(inp({ passRate: 0.25 }), sc()).llmPerLead).toBeCloseTo(base.llmPerLead * 2);
    expect(evaluate(inp({ passRate: 1 }), sc()).llmPerLead).toBeCloseTo(base.llmPerLead / 2);
  });
  it("a scenario without our own LLM pays no LLM cost", () => {
    const r = evaluate(inp(), sc({ usesOwnLlm: false }));
    expect(r.llmPerLead).toBe(0);
    expect(r.breakdownPerMeeting["llm"]).toBe(0);
    expect(r.monthlyCost).toBeCloseTo(7200);
  });
  it("review share scales the review cost", () => {
    expect(evaluate(inp(), sc({ reviewShare: 0.5 })).reviewPerLead).toBeCloseTo(2.5);
    expect(evaluate(inp(), sc({ reviewShare: 0 })).reviewPerLead).toBe(0);
  });
  it("the meeting-rate multiplier scales meetings", () => {
    expect(evaluate(inp(), sc({ meetingRateMultiplier: 2 })).meetingsPerMonth).toBeCloseTo(40);
  });
  it("more leads lower cost per meeting only through the fixed costs", () => {
    const doubled = evaluate(inp({ leadsPerMonth: 2000 }), sc());
    expect(doubled.costPerMeeting).toBeCloseTo(base.costPerMeeting - 75 / 2); // fixed 75 per meeting halves; the rest is unchanged
    expect(doubled.curve.a).toBeCloseTo(base.curve.a);
  });
  it("review minutes and hourly rate scale review linearly", () => {
    expect(evaluate(inp({ reviewMinutesPerDraft: 12 }), sc()).reviewPerLead).toBeCloseTo(10);
    expect(evaluate(inp({ loadedHourlyRate: 100 }), sc()).reviewPerLead).toBeCloseTo(10);
  });
});

describe("evaluate: impossible inputs", () => {
  it.each(["replyRate", "positiveShare", "meetingFromPositive", "showRate"] as const)("%s = 0 gives a clear error, not Infinity or NaN", (k) => {
    expect(() => evaluate(inp({ [k]: 0 }), sc())).toThrow(EconomicsError);
    expect(() => evaluate(inp({ [k]: 0 }), sc())).toThrow(new RegExp(`${k} is 0`));
  });
});

describe("crossover (closed form)", () => {
  // A: fixed 1000, 1/lead.  B: no fixed, 3/lead.  meetings/lead 0.02.
  // a_A = 1/0.02 = 50, f_A = 1000/0.02 = 50000; a_B = 150, f_B = 0  ->  L* = 50000 / 100 = 500
  const A = evaluate(inp(), plain("build", 1000, 1));
  const B = evaluate(inp(), plain("buy", 0, 3));
  it("finds the volume where the two cost the same per meeting", () => {
    const c = crossover(A, B)!;
    expect(c.leadsPerMonth).toBeCloseTo(500);
    const at500 = [evaluate(inp({ leadsPerMonth: 500 }), plain("build", 1000, 1)), evaluate(inp({ leadsPerMonth: 500 }), plain("buy", 0, 3))];
    expect(at500[0]!.costPerMeeting).toBeCloseTo(at500[1]!.costPerMeeting);
  });
  it("says who is cheaper on each side", () => {
    const c = crossover(A, B)!;
    expect(c.cheaperBelow).toBe("buy");
    expect(c.cheaperAbove).toBe("build");
  });
  it("is symmetric in argument order", () => {
    expect(crossover(B, A)!.leadsPerMonth).toBeCloseTo(500);
    expect(crossover(B, A)!.cheaperAbove).toBe("build");
  });
  it("reports nothing for parallel curves", () => {
    expect(crossover(A, evaluate(inp(), plain("buy", 5000, 1)))).toBeNull();
  });
  it("ignores a crossover at a negative volume (one option is always cheaper)", () => {
    expect(crossover(evaluate(inp(), plain("build", 0, 1)), evaluate(inp(), plain("buy", 100, 3)))).toBeNull();
  });
  it("lists every crossing pair among three scenarios", () => {
    const three = [A, B, evaluate(inp(), plain("hybrid", 400, 2))];
    const found = allCrossovers(three);
    expect(found.length).toBeGreaterThan(0);
    for (const c of found) expect(c.leadsPerMonth).toBeGreaterThan(0);
  });
});

describe("the shipped scenarios", () => {
  const cfg = realEconomics();
  it("all evaluate to a finite positive cost per meeting with sensible inputs", () => {
    for (const r of compare(inp({ replyRate: 0.04, positiveShare: 0.3, meetingFromPositive: 0.5, showRate: 0.75, reviewMinutesPerDraft: 1.5, loadedHourlyRate: 40, leadsPerMonth: 2000, passRate: 0.8, avgInputTokens: 500, avgOutputTokens: 120 }), cfg.scenarios)) {
      expect(Number.isFinite(r.costPerMeeting)).toBe(true);
      expect(r.costPerMeeting).toBeGreaterThan(0);
    }
  });
});
