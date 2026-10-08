import { z } from "zod";
import { appendAudit, type Clock } from "../db/audit.js";
import { listLeadRows, maskEmail } from "../db/leads.js";
import type { Db } from "../db/open.js";
import { QUEUES } from "../leads/config.js";

export const MAX_LIST_LIMIT = 20;
export const DEFAULT_LIST_LIMIT = 10;

export const listLeadsInputSchema = z.object({
  queue: z.enum(QUEUES).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
});
export type ListLeadsInput = z.infer<typeof listLeadsInputSchema>;

export function listLeadsTool(db: Db, clock: Clock, input: ListLeadsInput): string[] {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT;
  const rows = listLeadRows(db, { queue: input.queue, limit }).map((r) => ({
    leadId: r.leadId,
    receivedAt: r.receivedAt,
    email: maskEmail(r.email),
    domain: r.domain,
    queue: r.queue,
    score: r.score,
  }));
  appendAudit(db, clock, { actor: "mcp", action: "tool_call", detail: { tool: "list_leads", queue: input.queue ?? null, limit, returned: rows.length } });

  const summary = rows.length
    ? rows.map((r) => `#${r.leadId} ${r.receivedAt} ${r.email} -> ${r.queue} (score ${r.score})`).join("\n")
    : "No leads found.";
  return [summary, JSON.stringify(rows, null, 2)];
}
