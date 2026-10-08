import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { EnrichmentResult } from "./enrich.js";
import { scoreLead } from "./score.js";
import { lead, realConfig } from "./testing.js";

const company = (over = {}): EnrichmentResult => ({
  status: "found",
  company: { name: "Co", employees: 500, industry: "software", country: "US", segmentHints: [], ...over },
});
const none: EnrichmentResult = { status: "not_found" };
const ids = (r: ReturnType<typeof scoreLead>) => r.breakdown.map((e) => e.id);

describe("scoreLead (shipped config)", () => {
  const cfg = realConfig();
  it("scores fit from enrichment only", () => {
    const r = scoreLead(lead(), company(), cfg);
    expect(ids(r)).toEqual(["fit_size_midmarket", "fit_industry_target", "fit_country_priority"]);
    expect(r.score).toBe(30);
  });
  it("scores persona from title, case-insensitively and by whole word", () => {
    expect(ids(scoreLead(lead({ title: "VP of SALES" }), none, cfg))).toEqual(["persona_exec", "persona_function"]);
    // "director" contains "cto" but must not match the 'cto' keyword on its own; it matches 'director'
    const r = scoreLead(lead({ title: "Art Director" }), none, cfg);
    expect(r.breakdown[0]!.reason).toContain("director");
    expect(r.breakdown[0]!.reason).not.toContain("cto,");
    expect(ids(scoreLead(lead({ title: "Proctor" }), none, cfg))).toEqual([]);
  });
  it("scores intent from source and message keywords", () => {
    const r = scoreLead(lead({ source: "pricing_page", message: "We want a PILOT" }), none, cfg);
    expect(ids(r)).toEqual(["intent_pricing", "intent_message_buying"]);
    expect(r.intentPoints).toBe(30);
  });
  it("skips fit rules when enrichment is missing", () => {
    expect(scoreLead(lead(), none, cfg).breakdown).toEqual([]);
  });
  it("breakdown sums to rawTotal, and negative points apply", () => {
    const r = scoreLead(lead({ title: "Student intern" }), none, cfg);
    expect(r.rawTotal).toBe(-15);
    expect(r.score).toBe(0);
  });
  it("clamps at 100 while rawTotal keeps the real sum", () => {
    const r = scoreLead(lead({ title: "CEO operations", source: "demo_request", message: "pricing demo" }),
      company({ employees: 5000, industry: "saas" }), cfg);
    expect(r.rawTotal).toBeGreaterThan(100);
    expect(r.score).toBe(100);
    expect(r.breakdown.reduce((n, e) => n + e.points, 0)).toBe(r.rawTotal);
  });
});

describe("scoreLead (inline config)", () => {
  it("honors employees_range bounds inclusively", () => {
    const cfg = loadConfig({
      freeMailDomains: [], blockedDomains: [],
      scoring: { rules: [{ id: "r", type: "employees_range", group: "fit", min: 10, max: 20, points: 7, reason: "x" }] },
      routing: { rules: [{ id: "d", queue: "smb_nurture", label: "d", when: { type: "always" } }] },
    });
    const at = (n: number) => scoreLead(lead(), company({ employees: n }), cfg).score;
    expect([at(9), at(10), at(20), at(21)]).toEqual([0, 7, 7, 0]);
  });
});
