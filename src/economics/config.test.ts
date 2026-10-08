import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EconomicsConfigError, loadEconomics } from "./config.js";
import { realEconomics } from "./testing.js";

const raw = () => JSON.parse(readFileSync(new URL("../../config/economics.json", import.meta.url), "utf8"));
const errorOf = (c: unknown) => {
  try { loadEconomics(c); } catch (e) { expect(e).toBeInstanceOf(EconomicsConfigError); return (e as Error).message; }
  throw new Error("expected to throw");
};

describe("economics config", () => {
  it("the shipped file loads and has the three scenarios", () => {
    expect(realEconomics().scenarios.map((s) => s.id)).toEqual(["build", "buy", "hybrid"]);
  });
  it("is honest about being placeholders: the note says so and every block is tagged an assumption", () => {
    const c = realEconomics();
    expect(c._note).toMatch(/PLACEHOLDER/);
    expect(c._note).toMatch(/not Krisp's figures/);
    expect(c.defaults.source).toBe("assumption");
    for (const s of c.scenarios) expect(s.source).toBe("assumption");
  });
  it("rejects a rate outside 0 to 1, naming the path", () => {
    const c = raw(); c.defaults.replyRate = 1.5;
    expect(errorOf(c)).toContain("defaults.replyRate");
  });
  it("rejects negative money", () => {
    const c = raw(); c.scenarios[1].fixedMonthly.platformFee = -5;
    expect(errorOf(c)).toContain("scenarios.1.fixedMonthly.platformFee");
    const d = raw(); d.scenarios[0].perMeetingFee = -1;
    expect(errorOf(d)).toContain("perMeetingFee");
  });
  it("rejects a block with no source tag, or a source other than 'assumption'", () => {
    const c = raw(); delete c.scenarios[0].source;
    expect(errorOf(c)).toContain("scenarios.0.source");
    const d = raw(); d.defaults.source = "benchmark";
    expect(errorOf(d)).toContain("defaults.source");
  });
  it("rejects duplicate scenario ids, unknown ids and unknown keys", () => {
    const c = raw(); c.scenarios[1].id = "build";
    expect(errorOf(c)).toMatch(/scenarios\.1\.id: duplicate scenario id/);
    const d = raw(); d.scenarios[0].id = "outsource";
    expect(errorOf(d)).toContain("scenarios.0.id");
    const e = raw(); e.defaults.replyRte = 0.1;
    expect(errorOf(e)).toContain("replyRte");
  });
  it("rejects an empty scenario list and a zero meeting multiplier", () => {
    const c = raw(); c.scenarios = [];
    expect(errorOf(c)).toContain("scenarios");
    const d = raw(); d.scenarios[0].meetingRateMultiplier = 0;
    expect(errorOf(d)).toContain("meetingRateMultiplier");
  });
});
