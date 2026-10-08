import type { Queue } from "../leads/config.js";
import type { Fact, SdrConfig } from "./config.js";
import { countOccurrences, footerText, MODEL_FOOTER_RE } from "./footer.js";

export interface CheckResult {
  id: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export interface GuardrailReport {
  status: "passed" | "blocked";
  checks: CheckResult[];
  notChecked: string[];
}

export const NOT_CHECKED = [
  "paraphrased claims that evade the patterns above",
  "tone and fit for this prospect",
  "spam-trigger wording and deliverability content score",
  "role confusion (for example a small model writing 'our team' as if it worked at the prospect's company)",
  "number words ('fifty percent') and claims made without any number or term",
];

export interface GuardrailInput {
  subject: string;
  /** Text written by the model, before the footer. */
  body: string;
  /** Final text including the footer appended by code. */
  finalBody: string;
  claimsUsed: string[];
  queue: Queue;
  /** Lead-derived words that may legitimately appear (company name, title). */
  allowedLiterals: string[];
  flags: string[];
}

const TLDS = "com|net|org|io|ai|co|dev|app|xyz|info|biz|me|us|uk|de|ly|gl|to|example|invalid|test";
const URL_RE = /https?:\/\/|www\.|\]\(/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const DOMAIN_RE = new RegExp(`\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b`, "i");
const PLACEHOLDER_RE = /\{\{.*?\}\}|\[[A-Za-z][A-Za-z ]{1,30}\]|<[^>\s][^>]*>/;
const FACT_ID_RE = /\bF-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/;
const NUMBER_RE = /[$€£]?\d[\d,.]*%?/g;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) => new RegExp(`(?<![A-Za-z0-9])${esc(word)}(?![A-Za-z0-9])`, "i").test(text);

function stripLiterals(text: string, literals: string[]): string {
  return literals.filter(Boolean).reduce((t, l) => t.split(l).join(" "), text);
}

export function runGuardrails(input: GuardrailInput, facts: Fact[], config: SdrConfig): GuardrailReport {
  const checks: CheckResult[] = [];
  const add = (id: string, ok: boolean, detail: string, failStatus: "fail" | "warn" = "fail") =>
    checks.push({ id, status: ok ? "pass" : failStatus, detail });

  const byId = new Map(facts.map((f) => [f.id, f]));
  const text = `${input.subject}\n${input.body}`;
  const lower = text.toLowerCase();

  // 1. cited facts exist and are allowed for the queue
  const unknown = input.claimsUsed.filter((id) => !byId.has(id));
  const notAllowed = input.claimsUsed.filter((id) => byId.has(id) && !byId.get(id)!.allowedQueues.includes(input.queue));
  add("fact_ids_valid", unknown.length === 0 && notAllowed.length === 0,
    unknown.length || notAllowed.length
      ? `${unknown.length ? `unknown ids: ${unknown.join(", ")}. ` : ""}${notAllowed.length ? `not allowed for ${input.queue}: ${notAllowed.join(", ")}` : ""}`.trim()
      : "all cited fact ids exist and are allowed for this queue");

  // 2. at least one fact cited
  add("min_claims", input.claimsUsed.length >= 1, input.claimsUsed.length >= 1 ? `${input.claimsUsed.length} fact(s) cited` : "no approved fact cited");

  // 3. numbers, certifications and superlatives must be backed by a cited fact
  const cited = input.claimsUsed.map((id) => byId.get(id)?.text ?? "").join("\n").toLowerCase();
  const scanText = stripLiterals(text, input.allowedLiterals);
  const unsupported: string[] = [];
  for (const raw of scanText.match(NUMBER_RE) ?? []) {
    const tok = raw.replace(/[.,]+$/, "");
    if (!cited.includes(tok.toLowerCase())) unsupported.push(`"${tok}"`);
  }
  for (const term of config.needsSource.terms) {
    if (scanText.toLowerCase().includes(term.toLowerCase()) && !cited.includes(term.toLowerCase())) unsupported.push(`"${term}"`);
  }
  for (const word of config.needsSource.superlatives) {
    if (hasWord(scanText, word) && !hasWord(cited, word)) unsupported.push(`"${word}"`);
  }
  add("needs_source", unsupported.length === 0,
    unsupported.length ? `not supported by a cited fact: ${[...new Set(unsupported)].join(", ")}` : "no unsupported numbers, certifications or superlatives");

  // 4. phrases we never allow
  const plain = lower.replace(/[\u2018\u2019]/g, "'"); // curly apostrophes
  const banned = config.neverClaim.filter((p) => plain.includes(p.toLowerCase()));
  add("never_claim", banned.length === 0, banned.length ? `forbidden phrase(s): ${banned.map((b) => `"${b}"`).join(", ")}` : "no forbidden phrases");

  // 5. no links, addresses or domains
  const linkProblems = [URL_RE.test(text) && "link", EMAIL_RE.test(text) && "email address", DOMAIN_RE.test(text) && "domain name"].filter(Boolean);
  add("no_links_or_addresses", linkProblems.length === 0, linkProblems.length ? `contains a ${linkProblems.join(" and a ")}` : "no links, addresses or domains");

  // 6. no internal ids, prompt wording or placeholders
  const leaks: string[] = [];
  if (FACT_ID_RE.test(text) || facts.some((f) => text.includes(f.id))) leaks.push("a fact id");
  if (PLACEHOLDER_RE.test(text)) leaks.push("a placeholder");
  const leakWords = config.leakTerms.filter((t) => lower.includes(t.toLowerCase()));
  if (leakWords.length) leaks.push(`prompt wording (${leakWords.join(", ")})`);
  add("no_internal_ids", leaks.length === 0, leaks.length ? `leaks ${leaks.join(", ")}` : "no internal ids, placeholders or prompt wording");

  // 7. length
  const { subjectMax, bodyMin, bodyMax } = config.limits;
  const bodyLen = input.body.trim().length;
  const lengthOk = input.subject.trim().length > 0 && input.subject.length <= subjectMax && bodyLen >= bodyMin && input.body.length <= bodyMax;
  add("length", lengthOk, lengthOk ? "subject and body within limits" : `subject must be 1-${subjectMax} characters and the body ${bodyMin}-${bodyMax} (got ${input.subject.length} and ${bodyLen}); a greeting alone is not an email`);

  // 8. footer written by code, exactly once, and not impersonated by the model
  const footerCount = countOccurrences(input.finalBody, footerText(config));
  const modelFooter = MODEL_FOOTER_RE.test(text);
  add("footer", footerCount === 1 && !modelFooter,
    modelFooter ? "the model wrote its own opt-out wording" : footerCount !== 1 ? `footer appears ${footerCount} times` : "footer present exactly once, added by code");

  for (const flag of input.flags) {
    checks.push({ id: flag, status: "warn", detail: flag === "lead_message_dropped" ? "the prospect's message looked like instructions and was withheld from the model" : flag === "lead_title_dropped" ? "the prospect's title looked like instructions and was withheld" : "the first name had unusual characters and was replaced" });
  }

  return { status: checks.some((c) => c.status === "fail") ? "blocked" : "passed", checks, notChecked: NOT_CHECKED };
}
