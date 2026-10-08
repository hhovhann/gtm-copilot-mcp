import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { systemClock, type Clock } from "./db/audit.js";
import { openDb, resolveDbPath, type Db } from "./db/open.js";
import { NodeDnsResolver, type DnsResolver } from "./dns/resolver.js";
import { auditDomainInputSchema, auditDomainTool } from "./tools/auditDomain.js";
import { loadConfigFile, type RoutingConfig } from "./leads/config.js";
import { loadCompaniesFile, MockEnricher, type Enricher } from "./leads/enrich.js";
import { routeLeadInputSchema, routeLeadTool } from "./tools/routeLead.js";
import { loadFactsFile, loadSdrConfigFile, loadSuppressionFile, type Fact, type SdrConfig, type SuppressionEntry } from "./sdr/config.js";
import type { Drafter } from "./sdr/drafter.js";
import { createDrafter } from "./sdr/select.js";
import type { SdrDeps } from "./sdr/service.js";
import { loadEconomicsFile, type EconomicsConfig } from "./economics/config.js";
import { ToolError } from "./tools/errors.js";
import { estimateCostInputSchema, estimateCostTool } from "./tools/estimateCost.js";
import {
  approveDraftInputSchema, approveDraftTool, draftEmailInputSchema, draftEmailTool, getDraftInputSchema, getDraftTool,
  listDraftsInputSchema, listDraftsTool, rejectDraftInputSchema, rejectDraftTool,
} from "./tools/sdrTools.js";
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
  /** Overrides for the AI SDR drafter; by default everything is loaded lazily from config/, data/ and SDR_* env vars. */
  economics?: EconomicsConfig;
  sdr?: { drafter?: Drafter; facts?: Fact[]; suppression?: SuppressionEntry[]; config?: SdrConfig };
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
  let sdr: SdrDeps | undefined;
  const getSdr = (): SdrDeps => {
    if (sdr) return sdr;
    const config = deps.sdr?.config ?? loadSdrConfigFile(new URL("../config/sdr.json", import.meta.url));
    sdr = {
      db: getDb(),
      clock,
      config,
      drafter: deps.sdr?.drafter ?? createDrafter(config),
      facts: deps.sdr?.facts ?? loadFactsFile(new URL("../data/approved-facts.json", import.meta.url)),
      suppression: deps.sdr?.suppression ?? loadSuppressionFile(new URL("../data/suppression.json", import.meta.url)),
    };
    return sdr;
  };
  const getEconomics = () => ({
    db: getDb(),
    clock,
    economics: deps.economics ?? loadEconomicsFile(new URL("../config/economics.json", import.meta.url)),
    sdrConfig: deps.sdr?.config ?? loadSdrConfigFile(new URL("../config/sdr.json", import.meta.url)),
  });
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

  const guarded = async (run: () => string[] | Promise<string[]>) => {
    try {
      return asText(await run());
    } catch (err) {
      return toolErrorResult(err);
    }
  };

  server.registerTool(
    "draft_email",
    {
      description:
        "Draft the first outreach email for a stored lead using only approved facts. Runs guardrails and puts the draft in the approval queue. Skips leads that are suppressed, disqualified or over the draft limits without calling the model. Nothing is ever sent.",
      inputSchema: draftEmailInputSchema.shape,
    },
    async (input) => guarded(() => draftEmailTool(getSdr(), input)),
  );
  server.registerTool(
    "get_draft",
    { description: "Read a stored draft with its guardrail report and content hash.", inputSchema: getDraftInputSchema.shape, annotations: { readOnlyHint: true } },
    async (input) => guarded(() => getDraftTool(getSdr(), input)),
  );
  server.registerTool(
    "list_drafts",
    { description: "List drafts (no bodies), newest first, optionally by status.", inputSchema: listDraftsInputSchema.shape, annotations: { readOnlyHint: true } },
    async (input) => guarded(() => listDraftsTool(getSdr(), input)),
  );
  server.registerTool(
    "approve_draft",
    {
      description:
        "Approve a pending draft after a human has read it. Requires the contentHash of the exact content that was reviewed. Blocked drafts cannot be approved. This only marks the draft ready; it sends nothing. Do not approve on the human's behalf.",
      inputSchema: approveDraftInputSchema.shape,
    },
    async (input) => guarded(() => approveDraftTool(getSdr(), input)),
  );
  server.registerTool(
    "reject_draft",
    { description: "Reject a pending draft with a reason code and an optional note.", inputSchema: rejectDraftInputSchema.shape },
    async (input) => guarded(() => rejectDraftTool(getSdr(), input)),
  );

  server.registerTool(
    "estimate_cost_per_meeting",
    {
      description:
        "Compare build vs buy vs hybrid AI SDR options by cost per booked meeting. Shows where the money goes, the volume at which options cross over, how robust the recommendation is, and tags every input as measured, assumption or override. The funnel, cost and vendor numbers are placeholders, not benchmarks.",
      inputSchema: estimateCostInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => guarded(() => estimateCostTool(getEconomics(), input)),
  );

  return server;
}
