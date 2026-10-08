import { promises as dns } from "node:dns";

export type TxtResult =
  | { status: "ok"; records: string[] }
  | { status: "none" }
  | { status: "error"; message: string };

export interface DnsResolver {
  resolveTxt(name: string): Promise<TxtResult>;
}

const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export class NodeDnsResolver implements DnsResolver {
  async resolveTxt(name: string): Promise<TxtResult> {
    try {
      const chunks = await dns.resolveTxt(name);
      const records = chunks.map((parts) => parts.join(""));
      return records.length > 0 ? { status: "ok", records } : { status: "none" };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (NO_RECORD_CODES.has(code)) return { status: "none" };
      return { status: "error", message: `${code || "ERROR"}: ${(err as Error).message}` };
    }
  }
}
