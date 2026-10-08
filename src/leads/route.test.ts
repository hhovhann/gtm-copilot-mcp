import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { processLead } from "./index.js";
import { lead, realConfig, realEnricher } from "./testing.js";

const run = (l: ReturnType<typeof lead>, cfg = realConfig()) => processLead(l, realEnricher(), cfg);

describe("routing: one lead per route (shipped config and data)", () => {
  const cases: [string, ReturnType<typeof lead>, string, string][] = [
    ["disqualify", lead({ email: "x@mailinator.com" }), "disqualify", "blocked_domain"],
    ["developer_sdk", lead({ email: "cto@devtools-inc.example", title: "CTO", source: "demo_request", message: "Interested in the SDK" }), "developer_sdk", "developer_message"],
    ["call_center_specialist", lead({ email: "ops@megacontact.example", title: "Director of Operations", source: "demo_request" }), "call_center_specialist", "call_center_segment"],
    ["enterprise_ae", lead({ email: "vp@orbitbank.example", title: "VP Operations", source: "demo_request" }), "enterprise_ae", "enterprise"],
    ["midmarket_ae", lead({ email: "pat@brightpath.example", title: "Manager", source: "content_download" }), "midmarket_ae", "midmarket"],
    ["smb_nurture", lead({ email: "sam@tinystudio.example", source: "webinar" }), "smb_nurture", "default"],
    ["needs_review", lead({ email: "who@unknownco.example", source: "pricing_page", message: "Planning a pilot" }), "needs_review", "unknown_company_high_intent"],
  ];
  it.each(cases)("%s", async (_n, l, queue, ruleId) => {
    const d = await run(l);
    expect([d.route.queue, d.route.ruleId]).toEqual([queue, ruleId]);
    expect(d.route.reason).toContain(`Matched '${ruleId}'`);
  });

  it("sends free-mail leads to smb_nurture and says why", async () => {
    const d = await run(lead({ email: "jane@gmail.com", source: "demo_request" }));
    expect(d.route.queue).toBe("smb_nurture");
    expect(d.route.reason).toContain("gmail.com is on the free-mail list");
  });
  it("lets a free-mail developer asking about the SDK reach the developer team", async () => {
    const d = await run(lead({ email: "dev@gmail.com", message: "How do I embed your SDK?" }));
    expect(d.route.queue).toBe("developer_sdk");
  });
  it("explains why a big company did not reach enterprise (low score)", async () => {
    const d = await run(lead({ email: "m@acme-retail.example", title: "Manager", source: "content_download" }));
    expect(d.route.queue).toBe("midmarket_ae");
    expect(d.route.reason).toMatch(/enterprise \(2500 employees >= 1000; score 45 < 60\)/);
  });
  it("does not route low-intent unknown companies to needs_review", async () => {
    const d = await run(lead({ email: "who@unknownco.example", source: "content_download" }));
    expect(d.route.queue).toBe("smb_nurture");
  });
});

describe("routing: order wins", () => {
  const cfg = loadConfig({
    freeMailDomains: [], blockedDomains: ["brightpath.example"],
    scoring: { rules: [{ id: "s", type: "source_is", group: "intent", sources: ["other"], points: 1, reason: "x" }] },
    routing: { rules: [
      { id: "first", queue: "midmarket_ae", label: "M", when: { type: "employees_min", minEmployees: 100 } },
      { id: "second", queue: "disqualify", label: "D", when: { type: "domain_in_list", list: "blocked" } },
      { id: "fallback", queue: "smb_nurture", label: "S", when: { type: "always" } },
    ] },
  });
  it("picks the earlier rule when two would match", async () => {
    const d = await run(lead(), cfg);
    expect(d.route.ruleId).toBe("first");
    expect(d.route.trace).toHaveLength(1);
  });
});
