import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { factsForQueue, isSuppressed, loadFacts, loadSdrConfig, loadSuppression, SdrConfigError } from "./config.js";
import { realFacts, realSdrConfig, realSuppression } from "./testing.js";

const json = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
const errorOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(SdrConfigError); return (e as Error).message; }
  throw new Error("expected to throw");
};

describe("sdr config files", () => {
  it("the shipped files load", () => {
    expect(realSdrConfig().draftableQueues).toContain("enterprise_ae");
    expect(realFacts().length).toBeGreaterThan(3);
    expect(realSuppression().length).toBeGreaterThan(0);
  });
  it("every shipped fact is a pilot placeholder with no digits, so none can smuggle a statistic", () => {
    for (const f of realFacts()) {
      expect(f.status).toBe("pilot-placeholder");
      expect(f.text).not.toMatch(/\d/);
    }
  });
  it("rejects an invalid injection pattern, naming the path", () => {
    const c = json("config/sdr.json"); c.injectionPatterns[0] = "([unclosed";
    expect(errorOf(() => loadSdrConfig(c))).toContain("injectionPatterns.0");
  });
  it("rejects unknown keys and unknown queues", () => {
    const c = json("config/sdr.json"); c.limitz = {};
    expect(errorOf(() => loadSdrConfig(c))).toContain("limitz");
    const d = json("config/sdr.json"); d.draftableQueues = ["nope"];
    expect(errorOf(() => loadSdrConfig(d))).toContain("draftableQueues");
  });
  it("rejects duplicate fact ids and facts for unknown queues", () => {
    const f = json("data/approved-facts.json"); f.facts[1].id = f.facts[0].id;
    expect(errorOf(() => loadFacts(f))).toMatch(/facts\.1\.id: duplicate fact id/);
    const g = json("data/approved-facts.json"); g.facts[0].allowedQueues = ["marketing"];
    expect(errorOf(() => loadFacts(g))).toContain("allowedQueues");
  });
  it("filters facts by queue", () => {
    expect(factsForQueue(realFacts(), "developer_sdk").map((f) => f.id)).toEqual(["F-TRANS-01", "F-DEV-01"]);
    expect(factsForQueue(realFacts(), "disqualify")).toEqual([]);
  });
  it("matches suppression by email and by domain, case-insensitively", () => {
    const s = realSuppression();
    expect(isSuppressed(s, "JORDAN@regionalclinic.example", "regionalclinic.example")?.type).toBe("email");
    expect(isSuppressed(s, "anyone@OptedOut.example", "OPTEDOUT.example")?.type).toBe("domain");
    expect(isSuppressed(s, "other@regionalclinic.example", "regionalclinic.example")).toBeNull();
  });
  it("lowercases suppression values on load", () => {
    expect(loadSuppression({ _note: "x", entries: [{ type: "domain", value: " Bad.EXAMPLE ", reason: "r" }] })[0]!.value).toBe("bad.example");
  });
});
