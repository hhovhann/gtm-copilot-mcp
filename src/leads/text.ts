function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-word match. Returns the keywords found, in config order. */
export function matchKeywords(text: string | undefined, keywords: string[]): string[] {
  if (!text) return [];
  return keywords.filter((kw) => new RegExp(`(?<![a-z0-9])${escapeRegExp(kw)}(?![a-z0-9])`, "i").test(text));
}
