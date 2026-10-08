import { processLead, summarizeDecision } from "../leads/index.js";
import type { RoutingConfig } from "../leads/config.js";
import type { Enricher } from "../leads/enrich.js";
import { leadInputSchema, type Lead } from "../leads/model.js";

export { leadInputSchema as routeLeadInputSchema };

export async function routeLeadTool(input: Lead, enricher: Enricher, config: RoutingConfig): Promise<string[]> {
  const decision = await processLead(input, enricher, config);
  return [summarizeDecision(decision), JSON.stringify(decision, null, 2)];
}
