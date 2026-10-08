import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NodeDnsResolver, type DnsResolver } from "./dns/resolver.js";
import { auditDomainInputSchema, auditDomainTool } from "./tools/auditDomain.js";
import { ping, pingInputSchema } from "./tools/ping.js";

export function createServer(dns: DnsResolver = new NodeDnsResolver()): McpServer {
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

  return server;
}
