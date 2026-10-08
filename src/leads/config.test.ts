import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const valid = () => JSON.parse(readFileSync(new URL("../../config/routing.json", import.meta.url), "utf8"));
const errorOf = (raw: unknown) => {
  try { loadConfig(raw); } catch (e) { expect(e).toBeInstanceOf(ConfigError); return (e as Error).message; }
  throw new Error("expected loadConfig to throw");
};

describe("loadConfig", () => {
  it("loads the shipped config", () => expect(loadConfig(valid()).routing.rules.length).toBeGreaterThan(0));
  it("rejects an unknown scoring rule type, naming the path", () => {
    const c = valid(); c.scoring.rules[0].type = "vibes";
    expect(errorOf(c)).toContain("scoring.rules.0");
  });
  it("rejects a missing threshold, naming the field", () => {
    const c = valid();
    const r = c.routing.rules.find((x: any) => x.when.type === "employees_and_score");
    delete r.when.minScore;
    expect(errorOf(c)).toContain("minScore");
  });
  it("rejects duplicate ids", () => {
    const c = valid(); c.scoring.rules[1].id = c.scoring.rules[0].id;
    expect(errorOf(c)).toMatch(/scoring\.rules\.1\.id: duplicate rule id/);
  });
  it("rejects a config whose last routing rule is not 'always'", () => {
    const c = valid(); c.routing.rules.pop();
    expect(errorOf(c)).toContain("must be type 'always'");
  });
  it("rejects unknown keys such as typos", () => {
    const c = valid(); c.scoring.rules[0].pointz = 5;
    expect(errorOf(c)).toContain("pointz");
  });
});
