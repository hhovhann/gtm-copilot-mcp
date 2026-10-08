import { describe, expect, it } from "vitest";
import { appendFooter, footerText } from "./footer.js";
import { runGuardrails, type GuardrailInput } from "./guardrails.js";
import { CLAIMY_FACT, realFacts, realSdrConfig } from "./testing.js";

const cfg = realSdrConfig();
const facts = [...realFacts(), CLAIMY_FACT];
const GOOD_BODY = "Hi Vera,\n\nKrisp provides noise cancellation for calls and meetings. Would a short chat about this be useful for Orbit Bank?";

function run(over: Partial<GuardrailInput> = {}) {
  const body = over.body ?? GOOD_BODY;
  const input: GuardrailInput = {
    subject: "A quick idea for Orbit Bank", body, finalBody: appendFooter(body, cfg),
    claimsUsed: ["F-NC-01"], queue: "enterprise_ae", allowedLiterals: ["Orbit Bank", "VP Operations", "Vera"], flags: [], ...over,
  };
  if (over.body && !over.finalBody) input.finalBody = appendFooter(over.body, cfg);
  return runGuardrails(input, facts, cfg);
}
const status = (r: ReturnType<typeof run>, id: string) => r.checks.find((c) => c.id === id)?.status;
const failed = (r: ReturnType<typeof run>) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

describe("guardrails: a clean draft", () => {
  it("passes every check and still lists what was not checked", () => {
    const r = run();
    expect(r.status).toBe("passed");
    expect(failed(r)).toEqual([]);
    expect(r.checks.map((c) => c.id)).toEqual(["fact_ids_valid", "min_claims", "needs_source", "never_claim", "no_links_or_addresses", "no_internal_ids", "length", "footer"]);
    expect(r.notChecked.length).toBeGreaterThan(3);
    expect(r.notChecked.join(" ")).toMatch(/role confusion/);
  });
});

describe("fact_ids_valid and min_claims", () => {
  it("blocks an unknown fact id", () => expect(failed(run({ claimsUsed: ["F-NOPE-01"] }))).toContain("fact_ids_valid"));
  it("blocks a fact that is not allowed for the queue", () => {
    const r = run({ claimsUsed: ["F-DEV-01"] });
    expect(status(r, "fact_ids_valid")).toBe("fail");
    expect(r.checks.find((c) => c.id === "fact_ids_valid")!.detail).toMatch(/not allowed for enterprise_ae/);
  });
  it("blocks a draft that cites nothing", () => expect(failed(run({ claimsUsed: [] }))).toContain("min_claims"));
});

describe("needs_source", () => {
  const withBody = (sentence: string) => `Hi Vera,\n\n${sentence}`;
  it("blocks 'SOC 2' unless a cited fact contains it", () => {
    const body = withBody("Krisp provides noise cancellation and is SOC 2 certified.");
    expect(status(run({ body }), "needs_source")).toBe("fail");
    expect(status(run({ body, claimsUsed: ["F-NC-01"] }), "needs_source")).toBe("fail");
    expect(status(run({ body, claimsUsed: ["F-TEST-01"] }), "needs_source")).toBe("pass");
  });
  it("blocks a number unless a cited fact contains it", () => {
    const body = withBody("Krisp is used by 500 teams.");
    expect(status(run({ body }), "needs_source")).toBe("fail");
    expect(status(run({ body, claimsUsed: ["F-TEST-01"] }), "needs_source")).toBe("pass");
  });
  it("blocks a percentage, a currency amount and a fifteen-minute ask", () => {
    for (const s of ["Cut costs by 30%.", "It costs $40 per seat.", "Do you have 15 minutes?"]) {
      expect(status(run({ body: withBody(s) }), "needs_source"), s).toBe("fail");
    }
  });
  it("blocks a superlative unless a cited fact uses it", () => {
    const body = withBody("Krisp is the best option.");
    expect(status(run({ body }), "needs_source")).toBe("fail");
    expect(status(run({ body, claimsUsed: ["F-TEST-01"] }), "needs_source")).toBe("pass");
  });
  it("does not flag words that merely contain a superlative, or lead context such as a company name", () => {
    expect(status(run({ body: withBody("Krisp offers noise cancellation. A bestselling idea? Just ask.") }), "needs_source")).toBe("pass");
    expect(status(run({ body: withBody("Krisp offers noise cancellation for 3M."), allowedLiterals: ["3M"] }), "needs_source")).toBe("pass");
  });
});

describe("never_claim", () => {
  it.each(["We guarantee better calls.", "This is risk-free.", "As we discussed, this helps.", "Following our call, here is more."])("blocks %s", (s) =>
    expect(failed(run({ body: `Hi Vera,\n\n${s}` }))).toContain("never_claim"));
  it.each([
    "We've helped similar financial institutions streamline their operations.",
    "We\u2019ve helped teams like yours.",
    "Trusted by leading banks.",
    "Our customers see great results.",
    "It is a proven approach.",
  ])("blocks an invented track record: %s (regression: real Llama output)", (s) =>
    expect(failed(run({ body: `Hi Vera,\n\n${s}` }))).toContain("never_claim"));
  it("is case-insensitive", () => expect(failed(run({ body: "Hi Vera,\n\nGUARANTEED results." }))).toContain("never_claim"));
});

describe("no_links_or_addresses", () => {
  it.each([
    ["a link", "See https://evil.example/offer now."],
    ["a www link", "Visit www.evil.example today."],
    ["an email address", "Write to attacker@evil.example please."],
    ["a bare domain", "Look at krisp.ai for details."],
    ["a markdown link", "Read [this](x) first."],
  ])("blocks %s", (_n, s) => expect(failed(run({ body: `Hi Vera,\n\n${s}` }))).toContain("no_links_or_addresses"));
  it("also checks the subject", () => expect(failed(run({ subject: "Visit evil.example" }))).toContain("no_links_or_addresses"));
  it("allows ordinary punctuation like e.g. and i.e.", () =>
    expect(status(run({ body: "Hi Vera,\n\nTools like this, e.g. noise cancellation, help." }), "no_links_or_addresses")).toBe("pass"));
});

describe("no_internal_ids", () => {
  it.each([
    ["a fact id in brackets", "Krisp provides noise cancellation (F-NC-01)."],
    ["a bare fact id", "Per F-MEET-01 we can help."],
    ["a mustache placeholder", "Hi {{first_name}}, we can help."],
    ["a bracket placeholder", "Best, [Your Name]"],
    ["an angle placeholder", "Hi <name>, we can help."],
    ["prompt wording", "Based on the approved facts, we can help."],
  ])("blocks %s", (_n, s) => expect(failed(run({ body: `Hi Vera,\n\n${s}` }))).toContain("no_internal_ids"));
});

describe("length", () => {
  it("blocks a subject over the limit, a body over the limit, and empty text", () => {
    expect(failed(run({ subject: "s".repeat(cfg.limits.subjectMax + 1) }))).toContain("length");
    expect(failed(run({ body: "Hi Vera,\n\n" + "word ".repeat(300) }))).toContain("length");
    expect(failed(run({ subject: "  " }))).toContain("length");
    expect(failed(run({ body: " " }))).toContain("length");
  });
  it("accepts text exactly at the limits", () => {
    expect(status(run({ subject: "s".repeat(cfg.limits.subjectMax), body: "a".repeat(cfg.limits.bodyMax) }), "length")).toBe("pass");
    expect(status(run({ body: "a".repeat(cfg.limits.bodyMin) }), "length")).toBe("pass");
  });
  it("blocks a body that is only a greeting (regression: a real Llama 3.1 8B draft, 2026-10-08)", () => {
    for (const body of ["Hi Marcus,", "Hi Lena,\n\n", "a".repeat(cfg.limits.bodyMin - 1)]) {
      const r = run({ body });
      expect(failed(r), body).toContain("length");
      expect(r.checks.find((c) => c.id === "length")!.detail).toMatch(/greeting alone/);
    }
  });
});

describe("footer", () => {
  it("blocks a model-written opt-out line", () => {
    for (const s of ["Reply unsubscribe to stop.", "You can opt out any time.", "Stop receiving these emails by replying."]) {
      expect(failed(run({ body: `Hi Vera,\n\n${s}` })), s).toContain("footer");
    }
  });
  it("blocks a final body with the footer missing, or present twice", () => {
    expect(failed(run({ finalBody: GOOD_BODY }))).toContain("footer");
    expect(failed(run({ finalBody: `${appendFooter(GOOD_BODY, cfg)}\n\n${footerText(cfg)}` }))).toContain("footer");
  });
  it("accepts exactly one code-appended footer", () => expect(status(run(), "footer")).toBe("pass"));
});

describe("known limitation, pinned on purpose", () => {
  it("does NOT catch an unsupported benefit claim phrased without a number, term or listed phrase", () => {
    // Seen in a real Llama 3.1 8B draft: "This could save you time and ensure that important details aren't missed."
    const r = run({ body: "Hi Vera,\n\nKrisp provides noise cancellation for calls and meetings. This could save you time and ensure that important details are never missed." });
    expect(r.status).toBe("passed");
    expect(r.notChecked.join(" ")).toMatch(/paraphrased claims/);
  });
});

describe("informational flags", () => {
  it("adds a warning for each sanitizer flag and does not block on them", () => {
    const r = run({ flags: ["lead_message_dropped", "lead_title_dropped", "first_name_replaced"] });
    expect(r.status).toBe("passed");
    expect(r.checks.filter((c) => c.status === "warn").map((c) => c.id)).toEqual(["lead_message_dropped", "lead_title_dropped", "first_name_replaced"]);
  });
});

describe("combined failures", () => {
  it("reports every failing check, not just the first", () => {
    const r = run({ body: "Hi Vera,\n\nGet 50% off at https://evil.example, guaranteed.", claimsUsed: [] });
    expect(r.status).toBe("blocked");
    expect(failed(r)).toEqual(expect.arrayContaining(["min_claims", "needs_source", "never_claim", "no_links_or_addresses"]));
  });
});
