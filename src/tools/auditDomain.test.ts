import { describe, expect, it } from "vitest";
import { FakeResolver } from "../dns/fakeResolver.js";
import { auditDomainInputSchema, auditDomainTool } from "./auditDomain.js";

describe("audit_domain input", () => {
  it.each(["http://x.com", "x.com/path", "a b", "", "x.com:8080", "-x.com", "localhost", "a".repeat(254) + ".com"])(
    "rejects %j", (domain) => {
      expect(auditDomainInputSchema.safeParse({ domain }).success).toBe(false);
    });
  it("accepts a plain hostname", () => {
    expect(auditDomainInputSchema.safeParse({ domain: "mail.example.com" }).success).toBe(true);
  });
  it("rejects more than 10 selectors", () => {
    const dkimSelectors = Array.from({ length: 11 }, (_, i) => `s${i}`);
    expect(auditDomainInputSchema.safeParse({ domain: "x.com", dkimSelectors }).success).toBe(false);
  });
  it("lowercases the domain and returns summary plus JSON", async () => {
    const [summary, json] = await auditDomainTool({ domain: "X.COM" }, new FakeResolver());
    expect(summary).toContain("x.com");
    expect(JSON.parse(json!).domain).toBe("x.com");
  });
});
