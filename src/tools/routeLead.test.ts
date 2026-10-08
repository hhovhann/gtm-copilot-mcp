import { describe, expect, it } from "vitest";
import { lead, realConfig, realEnricher } from "../leads/testing.js";
import { routeLeadInputSchema, routeLeadTool } from "./routeLead.js";

describe("route_lead tool", () => {
  it("returns a text summary and JSON with breakdown and routeReason", async () => {
    const [summary, json] = await routeLeadTool(
      lead({ email: "vp@orbitbank.example", title: "VP Operations", source: "demo_request" }), realEnricher(), realConfig());
    expect(summary).toContain("Enterprise AE");
    expect(summary).toContain("Score:");
    const parsed = JSON.parse(json!);
    expect(parsed.scoreBreakdown.length).toBeGreaterThan(0);
    expect(parsed.route.reason).toContain("Matched 'enterprise'");
  });
  it("is deterministic", async () => {
    const l = lead({ email: "who@unknownco.example", source: "pricing_page", message: "pilot" });
    const a = await routeLeadTool(l, realEnricher(), realConfig());
    const b = await routeLeadTool(l, realEnricher(), realConfig());
    expect(a).toEqual(b);
  });
  it("does not echo the lead's email or name in the output", async () => {
    const [summary, json] = await routeLeadTool(lead({ email: "secret.person@orbitbank.example" }), realEnricher(), realConfig());
    expect(summary + json).not.toContain("secret.person");
  });
  it("rejects invalid input at the schema", () => {
    const schema = routeLeadInputSchema;
    expect(schema.safeParse({ email: "bad", firstName: "A", lastName: "B", source: "other" }).success).toBe(false);
    expect(schema.safeParse({ email: "a@x.com", firstName: "A", lastName: "B", source: "other", message: "x".repeat(2001) }).success).toBe(false);
  });
});
