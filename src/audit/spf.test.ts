import { describe, expect, it } from "vitest";
import { FakeResolver } from "../dns/fakeResolver.js";
import { checkSpf, countSpfLookups } from "./spf.js";

const spf = (...records: string[]) => new FakeResolver({ "x.com": records });
const msgs = (r: Awaited<ReturnType<typeof checkSpf>>) => r.findings.map((f) => f.message).join("|");

describe("checkSpf", () => {
  it("passes a single -all record", async () => {
    const r = await checkSpf("x.com", spf("v=spf1 include:_spf.google.com -all"));
    expect(r).toMatchObject({ status: "pass", points: 35, findings: [] });
  });
  it("fails when missing", async () => {
    const r = await checkSpf("x.com", new FakeResolver());
    expect(r).toMatchObject({ status: "fail", points: 0 });
    expect(r.findings[0]!.severity).toBe("critical");
  });
  it("ignores non-SPF TXT records", async () => {
    const r = await checkSpf("x.com", spf("google-site-verification=abc"));
    expect(msgs(r)).toContain("No SPF record");
  });
  it("flags multiple records", async () => {
    const r = await checkSpf("x.com", spf("v=spf1 -all", "v=spf1 ~all"));
    expect(r.status).toBe("fail");
    expect(msgs(r)).toContain("2 SPF records");
  });
  it("flags +all as critical with zero points", async () => {
    const r = await checkSpf("x.com", spf("v=spf1 +all"));
    expect(r).toMatchObject({ status: "fail", points: 0 });
  });
  it("flags ?all, missing all and ~all", async () => {
    expect((await checkSpf("x.com", spf("v=spf1 ?all"))).points).toBe(15);
    expect(msgs(await checkSpf("x.com", spf("v=spf1 ip4:1.2.3.4")))).toContain("no 'all'");
    expect(await checkSpf("x.com", spf("v=spf1 ~all"))).toMatchObject({ status: "pass", points: 30 });
  });
  it("flags more than 10 lookups", async () => {
    const includes = Array.from({ length: 11 }, (_, i) => `include:s${i}.com`).join(" ");
    const r = await checkSpf("x.com", spf(`v=spf1 ${includes} -all`));
    expect(msgs(r)).toContain("11 lookup");
  });
  it("counts lookup mechanisms but not ip4 or all", () => {
    expect(countSpfLookups("v=spf1 ip4:1.2.3.4 a mx include:a.com redirect=b.com -all")).toBe(4);
  });
  it("reports DNS errors as unchecked", async () => {
    const r = await checkSpf("x.com", new FakeResolver({ "x.com": { status: "error", message: "SERVFAIL" } }));
    expect(r.status).toBe("unchecked");
  });
});
