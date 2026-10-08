import { z } from "zod";
import { appendAudit, type Clock } from "../db/audit.js";
import { getStoredDecision } from "../db/leads.js";
import type { Db } from "../db/open.js";
import { summarizeDecision } from "../leads/index.js";
import { ToolError } from "./errors.js";

export const explainLeadInputSchema = z.object({ leadId: z.number().int().positive() });
export type ExplainLeadInput = z.infer<typeof explainLeadInputSchema>;

/** Returns the decision exactly as stored when the lead was routed; never recomputes. */
export function explainLeadTool(db: Db, clock: Clock, input: ExplainLeadInput): string[] {
  const stored = getStoredDecision(db, input.leadId);
  appendAudit(db, clock, { actor: "mcp", action: "tool_call", leadId: input.leadId, detail: { tool: "explain_lead", found: stored !== null } });
  if (!stored) throw new ToolError(`No lead with id ${input.leadId}. Use list_leads to find ids.`);

  const header =
    `Lead #${stored.leadId}: received ${stored.receivedAt}, decided ${stored.decidedAt}, ` +
    `config ${stored.configHash.slice(0, 12)} (stored decision, not recomputed)`;
  const body = { leadId: stored.leadId, receivedAt: stored.receivedAt, decidedAt: stored.decidedAt, configHash: stored.configHash, decision: stored.decision };
  return [`${header}\n${summarizeDecision(stored.decision)}`, JSON.stringify(body, null, 2)];
}
