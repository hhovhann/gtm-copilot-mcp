import { readFileSync } from "node:fs";
import { z } from "zod";

export const companySchema = z.object({
  name: z.string().min(1),
  employees: z.number().int().nonnegative(),
  industry: z.string().min(1),
  country: z.string().length(2),
  segmentHints: z.array(z.string()),
});
export type Company = z.infer<typeof companySchema>;

export type EnrichmentResult = { status: "found"; company: Company } | { status: "not_found" };

export interface Enricher {
  enrich(domain: string): Promise<EnrichmentResult>;
}

const companiesFileSchema = z.object({ _note: z.string(), companies: z.record(z.string(), companySchema) });

export function loadCompaniesFile(url: URL | string): Record<string, Company> {
  return companiesFileSchema.parse(JSON.parse(readFileSync(url, "utf8"))).companies;
}

/** Stand-in for a Clay-style enrichment API, backed by synthetic data. */
export class MockEnricher implements Enricher {
  constructor(private readonly companies: Record<string, Company>) {}

  async enrich(domain: string): Promise<EnrichmentResult> {
    return Object.hasOwn(this.companies, domain)
      ? { status: "found", company: this.companies[domain]! }
      : { status: "not_found" };
  }
}
