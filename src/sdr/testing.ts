import { fixedClock, makeApp, validBody } from "../db/testing.js";
import type { Clock } from "../db/audit.js";
import { loadFactsFile, loadSdrConfigFile, loadSuppressionFile, type Fact, type SdrConfig } from "./config.js";
import type { DraftFields, Drafter, DraftRequest, DrafterResult } from "./drafter.js";
import type { SdrDeps } from "./service.js";

export const realSdrConfig = (): SdrConfig => loadSdrConfigFile(new URL("../../config/sdr.json", import.meta.url));
export const realFacts = (): Fact[] => loadFactsFile(new URL("../../data/approved-facts.json", import.meta.url));
export const realSuppression = () => loadSuppressionFile(new URL("../../data/suppression.json", import.meta.url));

/** Facts that contain the things the guardrails normally refuse to let a draft claim. */
export const CLAIMY_FACT: Fact = {
  id: "F-TEST-01",
  text: "Krisp is SOC 2 certified and used by 500 teams, and is the best option.",
  category: "test",
  allowedQueues: ["enterprise_ae"],
  source: "test fixture",
  status: "pilot-placeholder",
};

export const goodFields = (over: Partial<DraftFields> = {}): DraftFields => ({
  subject: "A quick idea for Orbit Bank",
  body: "Hi Vera,\n\nKrisp provides noise cancellation for calls and meetings. Would a short chat about this be useful for your team?",
  claimsUsed: ["F-NC-01"],
  cta: "reply_question",
  ...over,
});

export const okResult = (fields: Partial<DraftFields> = {}, usage = { inputTokens: 120, outputTokens: 60 }): DrafterResult => ({
  ok: true, draft: goodFields(fields), usage, model: "scripted-model", drafter: "scripted",
});

/** Test drafter: records every request and answers from a function. Never touches a network. */
export class ScriptedDrafter implements Drafter {
  readonly name = "scripted";
  calls: DraftRequest[] = [];
  constructor(private readonly respond: (req: DraftRequest) => DrafterResult | Promise<DrafterResult> = () => okResult()) {}
  async draft(req: DraftRequest): Promise<DrafterResult> {
    this.calls.push(req);
    return this.respond(req);
  }
}

export function makeSdr(opts: { config?: SdrConfig; drafter?: ScriptedDrafter; facts?: Fact[] } = {}) {
  const app = makeApp();
  const clockRef = { now: fixedClock() };
  const clock: Clock = () => clockRef.now;
  const drafter = opts.drafter ?? new ScriptedDrafter();
  const deps: SdrDeps = {
    db: app.db,
    clock,
    drafter,
    facts: opts.facts ?? realFacts(),
    suppression: realSuppression(),
    config: opts.config ?? realSdrConfig(),
  };
  let n = 0;
  const seed = async (body: Record<string, unknown> = {}): Promise<number> => {
    const res = await app.post(validBody(body), { "idempotency-key": `seed-${++n}` });
    return ((await res.json()) as { leadId: number }).leadId;
  };
  return { ...app, deps, drafter, clockRef, seed };
}

export const ENTERPRISE = {}; // validBody() default: VP Operations at orbitbank.example, demo_request
export const DISQUALIFIED = { email: "x@mailinator.com", title: undefined, source: "other" };
export const NEEDS_REVIEW = { email: "who@unknownco.example", title: undefined, source: "pricing_page", message: "Planning a pilot" };
export const SUPPRESSED_EMAIL = { email: "Jordan@RegionalClinic.example", title: "Manager", source: "content_download" };
export const SUPPRESSED_DOMAIN = { email: "sam@optedout.example", title: undefined, source: "content_download" };
export const DEVELOPER = { email: "cto@devtools-inc.example", title: "CTO", source: "demo_request", message: "Interested in the SDK" };
export const CALL_CENTER = { email: "ops@megacontact.example", title: "Director of Operations", source: "demo_request" };
