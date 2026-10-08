import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ping, pingInputSchema } from "./tools/ping.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "gtm-copilot", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      description: "Health check. Returns pong, optionally echoing a message.",
      inputSchema: pingInputSchema.shape,
    },
    async (input) => ({ content: [{ type: "text", text: ping(input) }] }),
  );

  return server;
}
