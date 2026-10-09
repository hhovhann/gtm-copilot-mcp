// Calls one tool on the server through a real MCP client over stdio and prints the result.
// Usage: npx tsx scripts/mcp-call.ts <tool> '<json arguments>'
// Example: npx tsx scripts/mcp-call.ts audit_domain '{"domain":"github.com"}'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const [tool, rawArgs = "{}"] = process.argv.slice(2);
if (!tool) {
  console.error("Usage: npx tsx scripts/mcp-call.ts <tool> '<json arguments>'");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const transport = new StdioClientTransport({
  command: `${root}node_modules/.bin/tsx`,
  args: [`${root}src/index.ts`],
  env: { ...(process.env as Record<string, string>) },
  stderr: "ignore",
});
const client = new Client({ name: "mcp-call", version: "0.1.0" });

try {
  await client.connect(transport);
  const result = (await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  // The first content block is the human-readable summary; the second (if any) is JSON.
  const text = result.content.find((c) => c.type === "text")?.text ?? "";
  console.log(text);
  process.exitCode = result.isError ? 1 : 0;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close();
}
