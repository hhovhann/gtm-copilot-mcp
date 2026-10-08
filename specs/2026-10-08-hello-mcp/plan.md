# Phase 1 Plan - Hello MCP

## Group 1 - Package Setup

1. `npm init`, set `"type": "module"`, Node engine `>=20`
2. Install `@modelcontextprotocol/sdk` and `zod` (pin exact versions)
3. Install dev dependencies: `typescript`, `tsx`, `vitest`, `@types/node` (pin exact versions)
4. Add `tsconfig.json` with `"strict": true`, `module`/`moduleResolution` set to `NodeNext`, `target` ES2022
5. Add `.gitignore` and an empty `.env.example`

## Group 2 - Ping Tool

6. Create `src/tools/ping.ts` with a Zod input schema and a pure `ping(input)` function
7. Create `src/tools/ping.test.ts` covering: no message, with message, message over 200 chars rejected

## Group 3 - MCP Server

8. Create `src/server.ts` that builds an `McpServer` named `gtm-copilot` and registers `ping`
9. Create `src/index.ts` that connects the server to `StdioServerTransport`; errors go to stderr
10. Add npm scripts: `dev`, `test`, `typecheck`

## Group 4 - Verify

11. Run `npm run typecheck` and `npm test`
12. Start the server and send an MCP `tools/list` and `tools/call` request over stdio; confirm responses
13. Register the server in Claude Code (`claude mcp add`) and call `ping` from a session
14. Tick the checklist in `validation.md`, then mark Phase 1 done in `roadmap.md`
