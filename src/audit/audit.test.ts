import { describe, expect, it } from "vitest";
import { FakeResolver } from "../dns/fakeResolver.js";
import { auditDomain, summarize } from "./index.js";

const perfect = {
  "x.com": ["v=spf1 include:_spf.google.com -all"],
  "_dmarc.x.com": ["v=DMARC1; p=reject; rua=mailto:d@x.com"],
  "google._domainkey.x.com": ["v=DKIM1; p=MIGf"],
};

describe("auditDomain", () => {
  it("scores a perfect setup 100", async () => {
    const r = await auditDomain("x.com", new FakeResolver(perfect));
    expect(r.score).toBe(100);
    expect(r.fixes).toEqual([]);
  });
  it("scores no records 0 with critical fixes first", async () => {
    const r = await auditDomain("x.com", new FakeResolver());
    expect(r.score).toBe(0);
    expect(r.fixes[0]!.severity).toBe("critical");
    expect(r.fixes.map((f) => f.severity)).toEqual([...r.fixes.map((f) => f.severity)].sort(
      (a, b) => ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b)));
  });
  it("lands between for SPF only", async () => {
    const r = await auditDomain("x.com", new FakeResolver({ "x.com": perfect["x.com"] }));
    expect(r.score).toBe(35);
  });
  it("excludes failed lookups from the score and flags them", async () => {
    const dns = new FakeResolver({ ...perfect, "_dmarc.x.com": { status: "error", message: "timeout" } });
    const r = await auditDomain("x.com", dns);
    expect(r.score).toBe(100);
    expect(r.checks.find((c) => c.check === "dmarc")!.status).toBe("unchecked");
    expect(summarize(r)).toContain("Could not check DMARC");
  });
  it("returns a null score when nothing could be checked", async () => {
    const err = { status: "error", message: "down" } as const;
    const dns = new FakeResolver({ "x.com": err, "_dmarc.x.com": err,
      ...Object.fromEntries(["default", "google", "selector1", "selector2", "k1", "s1", "s2"].map((s) => [`${s}._domainkey.x.com`, err])) });
    const r = await auditDomain("x.com", dns);
    expect(r.score).toBeNull();
    expect(summarize(r)).toContain("score unavailable");
  });
});
