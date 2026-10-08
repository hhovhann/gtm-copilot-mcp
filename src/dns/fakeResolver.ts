import type { DnsResolver, TxtResult } from "./resolver.js";

/** Test helper: serves canned TXT records. Unknown names return "none". */
export class FakeResolver implements DnsResolver {
  constructor(private readonly answers: Record<string, TxtResult | string[]> = {}) {}

  async resolveTxt(name: string): Promise<TxtResult> {
    const answer = this.answers[name];
    if (answer === undefined) return { status: "none" };
    return Array.isArray(answer) ? { status: "ok", records: answer } : answer;
  }
}
