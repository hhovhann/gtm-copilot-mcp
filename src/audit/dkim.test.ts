import { describe, expect, it } from "vitest";
import { FakeResolver } from "../dns/fakeResolver.js";
import { checkDkim } from "./dkim.js";

describe("checkDkim", () => {
  it("passes on a default selector", async () => {
    const dns = new FakeResolver({ "google._domainkey.x.com": ["v=DKIM1; k=rsa; p=MIGf"] });
    expect(await checkDkim("x.com", dns)).toMatchObject({ status: "pass", points: 30 });
  });
  it("passes on a supplied selector", async () => {
    const dns = new FakeResolver({ "hs1._domainkey.x.com": ["v=DKIM1; p=MIGf"] });
    expect((await checkDkim("x.com", dns, ["hs1"])).status).toBe("pass");
    expect((await checkDkim("x.com", dns)).status).toBe("fail");
  });
  it("says 'not found under the selectors tried' rather than claiming absence", async () => {
    const r = await checkDkim("x.com", new FakeResolver());
    expect(r.status).toBe("fail");
    expect(r.findings[0]!.message).toContain("under the selectors tried");
  });
  it("treats an empty p= as revoked, not valid", async () => {
    const dns = new FakeResolver({ "default._domainkey.x.com": ["v=DKIM1; p="] });
    const r = await checkDkim("x.com", dns);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.severity === "critical")).toBe(true);
  });
  it("is unchecked when every lookup fails, but passes if one key is found", async () => {
    const err = { status: "error", message: "timeout" } as const;
    const all: Record<string, typeof err> = {};
    for (const s of ["default", "google", "selector1", "selector2", "k1", "s1", "s2"]) all[`${s}._domainkey.x.com`] = err;
    expect((await checkDkim("x.com", new FakeResolver(all))).status).toBe("unchecked");
    const mixed = new FakeResolver({ ...all, "s1._domainkey.x.com": ["v=DKIM1; p=abc"] });
    expect((await checkDkim("x.com", mixed)).status).toBe("pass");
  });
});
