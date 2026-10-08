import { z } from "zod";
import { auditDomain, summarize } from "../audit/index.js";
import type { DnsResolver } from "../dns/resolver.js";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

export const hostnameSchema = z
  .string()
  .max(253)
  .refine((d) => d.includes(".") && d.split(".").every((l) => LABEL.test(l)), {
    message: "Must be a plain hostname like example.com (no scheme, path, port or spaces).",
  });

export const auditDomainInputSchema = z.object({
  domain: hostnameSchema,
  dkimSelectors: z.array(z.string().regex(LABEL).max(63)).max(10).optional(),
});

export type AuditDomainInput = z.infer<typeof auditDomainInputSchema>;

export async function auditDomainTool(input: AuditDomainInput, dns: DnsResolver): Promise<string[]> {
  const report = await auditDomain(input.domain.toLowerCase(), dns, { dkimSelectors: input.dkimSelectors });
  return [summarize(report), JSON.stringify(report, null, 2)];
}
