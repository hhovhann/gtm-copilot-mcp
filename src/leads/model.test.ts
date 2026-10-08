import { describe, expect, it } from "vitest";
import { deriveDomain, leadInputSchema } from "./model.js";

const base = { email: "a@x.com", firstName: "A", lastName: "B", source: "demo_request" };

describe("deriveDomain", () => {
  it("normalizes case and whitespace", () => expect(deriveDomain("Jane@ACME.com ")).toBe("acme.com"));
  it("keeps subdomains", () => expect(deriveDomain("a@mail.acme.com")).toBe("mail.acme.com"));
  it.each(["nope", "a@", "@x.com", "a@localhost", "a@-x.com", "a@x..com"])("rejects %j", (e) =>
    expect(deriveDomain(e)).toBeNull());
});

describe("leadInputSchema", () => {
  it("accepts a valid lead and trims the email", () => {
    const r = leadInputSchema.safeParse({ ...base, email: "  Jane@ACME.com " });
    expect(r.success).toBe(true);
  });
  it.each([
    ["invalid email", { email: "not-an-email" }],
    ["missing first name", { firstName: "" }],
    ["unknown source", { source: "billboard" }],
    ["message over 2000 chars", { message: "x".repeat(2001) }],
  ])("rejects %s", (_n, over) => expect(leadInputSchema.safeParse({ ...base, ...over }).success).toBe(false));
});
