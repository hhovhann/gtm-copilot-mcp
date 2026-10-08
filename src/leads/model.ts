import { z } from "zod";

export const LEAD_SOURCES = ["demo_request", "pricing_page", "webinar", "content_download", "partner", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Returns the lowercase domain of an email, or null if it is not a plain hostname. */
export function deriveDomain(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return null;
  const domain = trimmed.slice(at + 1).toLowerCase();
  return domain.length <= 253 && HOSTNAME.test(domain) ? domain : null;
}

export const leadInputSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email().refine((e) => deriveDomain(e) !== null, { message: "Email must have a valid domain." })),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  title: z.string().trim().max(200).optional(),
  source: z.enum(LEAD_SOURCES),
  message: z.string().max(2000).optional(),
});

export type Lead = z.infer<typeof leadInputSchema>;
