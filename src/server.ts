import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { systemClock, type Clock } from "./db/audit.js";
import { openDb, resolveDbPath, type Db } from "./db/open.js";
import { NodeDnsResolver, type DnsResolver } from "./dns/resolver.js";
import { auditDomainInputSchema, auditDomainTool } from "./tools/auditDomain.js";
import { loadConfigFile, type RoutingConfig } from "./leads/config.js";
import { loadCompaniesFile, MockEnricher, type Enricher } from "./leads/enrich.js";
import { routeLeadInputSchema, routeLeadTool } from "./tools/routeLead.js";
import { ToolError } from "./tools/errors.js";
import { explainLeadInputSchema, explainLeadTool } from "./tools/explainLead.js";
import { listLeadsInputSchema, listLeadsTool } from "./tools/listLeads.js";
import { ping, pingInputSchema } from "./tools/ping.js";

export interface ServerDeps {
  dns?: DnsResolver;
  enricher?: Enricher;
  routingConfig?: RoutingConfig;
  /** Injected in tests; otherwise opened lazily from GTM_DB_PATH on first use. */
  db?: Db;
  clock?: Clock;
}

const asText = (texts: string[]) => ({ content: texts.map((text) => ({ type: "text" as const, text })) });

function toolErrorResult(err: unknown) {
  if (err instanceof ToolError) return { isError: true, content: [{ type: "text" as const, text: err.message }] };
  throw err;
}

export function createServer(deps: ServerDeps = {}): McpServer {
  const dns = deps.dns ?? new NodeDnsResolver();
  const enricher = deps.enricher ?? new MockEnricher(loadCompaniesFile(new URL("../data/companies.json", import.meta.url)));
  const clock = deps.clock ?? systemClock;
  let db = deps.db;
  const getDb = () => (db ??= openDb(resolveDbPath()));
  const routingConfig = deps.routingConfig ?? loadConfigFile(new URL("../config/routing.json", import.meta.url));
  const server = new McpServer({ name: "gtm-copilot", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      description: "Health check. Returns pong, optionally echoing a message.",
      inputSchema: pingInputSchema.shape,
    },
    async (input) => ({ content: [{ type: "text", text: ping(input) }] }),
  );

  server.registerTool(
    "audit_domain",
    {
      description:
        "Audit a sending domain's email authentication (SPF, DKIM, DMARC) via public DNS. Returns a 0-100 score and prioritized fixes. DKIM can only be checked for known selectors.",
      inputSchema: auditDomainInputSchema.shape,
    },
    async (input) => ({
      content: (await auditDomainTool(input, dns)).map((text) => ({ type: "text" as const, text })),
    }),
  );

  server.registerTool(
    "route_lead",
    {
      description:
        "Enrich, score (0-100) and route an inbound lead to an owner queue. Returns the score breakdown and the rule that matched, with why earlier rules did not. Deterministic; uses synthetic enrichment data.",
      inputSchema: routeLeadInputSchema.shape,
    },
    async (input) => ({
      content: (await routeLeadTool(input, enricher, routingConfig)).map((text) => ({ type: "text" as const, text })),
    }),
  );

  server.registerTool(
    "explain_lead",
    {
      description:
        "Explain why a stored lead was routed where it was. Returns the decision exactly as recorded when the lead arrived (score breakdown, rule trace, config hash), not a recomputation.",
      inputSchema: explainLeadInputSchema.shape,
    },
    async (input) => {
      try {
        return asText(explainLeadTool(getDb(), clock, input));
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_leads",
    {
      description: "List the most recent leads received by the webhook, newest first, with masked emails. Use it to find ids for explain_lead.",
      inputSchema: listLeadsInputSchema.shape,
    },
    async (input) => asText(listLeadsTool(getDb(), clock, input)),
  );

  return server;
}
