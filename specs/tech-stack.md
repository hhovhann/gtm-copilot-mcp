# Tech Stack

## Overview

TypeScript-first, single Node package. Small surface area, strict types, easy to run and review.

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20+ | Stable, matches MCP SDK |
| Language | TypeScript (strict) | JD asks for Python or TypeScript; shared types end to end |
| MCP | `@modelcontextprotocol/sdk` | Official SDK; stdio transport for Claude Desktop / Claude Code |
| Webhook API | Hono + `@hono/node-server` | Tiny, typed, fast to test |
| Validation | Zod | Tool inputs and webhook payloads validated at the boundary |
| Storage | SQLite (`better-sqlite3`) | Stand-in CRM, audit log, approval queue; zero setup |
| LLM | Anthropic SDK (`claude-sonnet-5-5`) | Email drafting; mockable for tests and offline runs |
| DNS | `node:dns/promises` | Real SPF/DKIM/DMARC lookups, no credentials |
| Tests | Vitest | Fast, TS-native |
| Dev runner | `tsx` | No build step during development |

## Conventions

- Pin exact dependency versions (no `^`).
- Every external call (DNS, LLM) sits behind an interface so tests use fakes.
- Every tool call and every guardrail decision is written to the audit log.
- Secrets only via environment variables; `.env.example` lists them.
- Mock data lives in `data/` and is clearly marked synthetic.
