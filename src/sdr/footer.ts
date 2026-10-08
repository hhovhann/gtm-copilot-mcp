import type { SdrConfig } from "./config.js";

export function footerText(config: SdrConfig): string {
  const f = config.footer;
  return `--\n${f.senderName}\n${f.postalAddress}\n${f.unsubscribeLine}`;
}

/** The footer is appended by code. The model never writes it. */
export function appendFooter(body: string, config: SdrConfig): string {
  return `${body.trimEnd()}\n\n${footerText(config)}`;
}

export function countOccurrences(haystack: string, needle: string): number {
  return needle ? haystack.split(needle).length - 1 : 0;
}

/** True if model-written text pretends to be an opt-out line. */
export const MODEL_FOOTER_RE = /unsubscribe|opt[\s-]?out|stop receiving/i;
