# Phase 1 Requirements - Hello MCP

## Goal

A TypeScript project that runs an MCP server over stdio with a single `ping` tool, so Claude can connect and call it.
This proves the toolchain and the Claude connection before any GTM logic is added.

## Scope

- TypeScript project, `strict: true`, ESM, Node 20+
- Dependencies pinned to exact versions (no `^` or `~`)
- MCP server using `@modelcontextprotocol/sdk` over stdio
- One tool, `ping`:
  - Input: optional `message` (string, max 200 chars), validated with Zod
  - Output: text `pong` when no message is given, otherwise `pong: <message>`
- Vitest set up with tests for the `ping` handler
- npm scripts: `dev` (tsx), `test`, `typecheck`
- `.gitignore` (node_modules, dist, .env) and `.env.example` (empty for now)

## Out of Scope

- Any GTM tools, DNS, SQLite, Hono or LLM calls
- Build/publish pipeline, CI, Docker
- Logging to the audit log (arrives in Phase 4)

## Context

- Stdout is the MCP protocol channel on stdio, so nothing else may write to stdout. Diagnostics go to stderr.
- The `ping` logic lives in its own function, separate from MCP wiring, so it is unit-testable without a transport.

## Decisions

- Server name: `gtm-copilot`, version `0.1.0`
- Layout: `src/server.ts` (wiring), `src/tools/ping.ts` (logic), `src/index.ts` (entry)
