import { describe, expect, it } from "vitest";
import { FakeResolver } from "../dns/fakeResolver.js";
import { checkDmarc } from "./dmarc.js";

const dmarc = (rec: string) => new FakeResolver({ "_dmarc.x.com": [rec] });

describe("checkDmarc", () => {
  it("scores reject with rua in full", async () => {
    const r = await checkDmarc("x.com", dmarc("v=DMARC1; p=reject; rua=mailto:d@x.com"));
    expect(r).toMatchObject({ status: "pass", points: 35 });
  });
  it("warns on p=none", async () => {
    const r = await checkDmarc("x.com", dmarc("v=DMARC1; p=none; rua=mailto:d@x.com"));
    expect(r).toMatchObject({ status: "warn", points: 15 });
  });
  it("notes quarantine as info and still passes", async () => {
    const r = await checkDmarc("x.com", dmarc("v=DMARC1; p=quarantine; rua=mailto:d@x.com"));
    expect(r).toMatchObject({ status: "pass", points: 30 });
    expect(r.findings[0]!.severity).toBe("info");
  });
  it("warns on missing rua", async () => {
    const r = await checkDmarc("x.com", dmarc("v=DMARC1; p=reject"));
    expect(r.points).toBe(30);
    expect(r.findings[0]!.message).toContain("rua");
  });
  it("flags pct under 100", async () => {
    const r = await checkDmarc("x.com", dmarc("v=DMARC1; p=quarantine; pct=50; rua=mailto:d@x.com"));
    expect(r.points).toBe(25);
    expect(r.findings.map((f) => f.message).join("|")).toContain("50%");
  });
  it("fails when missing or when p is invalid", async () => {
    expect((await checkDmarc("x.com", new FakeResolver())).points).toBe(0);
    expect((await checkDmarc("x.com", dmarc("v=DMARC1; rua=mailto:d@x.com"))).status).toBe("fail");
  });
  it("reports DNS errors as unchecked", async () => {
    const r = await checkDmarc("x.com", new FakeResolver({ "_dmarc.x.com": { status: "error", message: "timeout" } }));
    expect(r.status).toBe("unchecked");
  });
});
