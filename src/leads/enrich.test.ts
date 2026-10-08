import { describe, expect, it } from "vitest";
import { MockEnricher } from "./enrich.js";
import { realEnricher } from "./testing.js";

describe("MockEnricher", () => {
  it("returns found for a known domain", async () => {
    const r = await realEnricher().enrich("orbitbank.example");
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.company.employees).toBe(8000);
  });
  it("returns not_found for an unknown domain without throwing", async () => {
    expect(await realEnricher().enrich("nobody.example")).toEqual({ status: "not_found" });
  });
  it("does not resolve prototype keys", async () => {
    expect((await new MockEnricher({}).enrich("constructor")).status).toBe("not_found");
  });
});
