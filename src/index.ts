import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("gtm-copilot MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
