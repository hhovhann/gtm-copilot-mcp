import type { SdrConfig } from "./config.js";

export interface SanitizedLead {
  firstName: string;
  title?: string;
  message?: string;
  /** Check ids to surface as warnings in the guardrail report. */
  flags: ("lead_message_dropped" | "lead_title_dropped" | "first_name_replaced")[];
}

const NAME_OK = /^[\p{L}][\p{L}\p{M}' .-]{0,49}$/u;
const TITLE_MAX = 100;

export function looksLikeInjection(text: string, config: SdrConfig): boolean {
  return config.injectionPatterns.some((p) => new RegExp(p, "i").test(text));
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Lead-supplied text is untrusted: drop it if it looks like instructions, otherwise bound and defang it. */
export function sanitizeLead(
  lead: { firstName: string; title?: string | null; message?: string | null },
  config: SdrConfig,
): SanitizedLead {
  const flags: SanitizedLead["flags"] = [];

  let firstName = collapse(lead.firstName);
  if (!NAME_OK.test(firstName) || looksLikeInjection(firstName, config)) {
    firstName = "there";
    flags.push("first_name_replaced");
  }

  let title: string | undefined;
  if (lead.title) {
    const t = collapse(lead.title).slice(0, TITLE_MAX);
    if (looksLikeInjection(lead.title, config)) flags.push("lead_title_dropped");
    else title = t || undefined;
  }

  let message: string | undefined;
  if (lead.message && lead.message.trim()) {
    if (looksLikeInjection(lead.message, config)) flags.push("lead_message_dropped");
    else message = lead.message.replace(/<\/?\s*lead_message[^>]*>/gi, "").trim().slice(0, config.limits.messageMaxChars) || undefined;
  }

  return { firstName, title, message, flags };
}
