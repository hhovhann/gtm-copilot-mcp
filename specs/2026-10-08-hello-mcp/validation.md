# Phase 1 Validation - Hello MCP

Phase 1 is done when every box below is checked.

## Automated

- [x] `npm run typecheck` exits 0 with `strict` enabled
- [x] `npm test` passes, including:
  - [x] `ping({})` returns `pong`
  - [x] `ping({ message: "hi" })` returns `pong: hi`
  - [x] a message longer than 200 characters is rejected by the schema

## Protocol

- [x] Over stdio, `tools/list` returns exactly one tool named `ping`
- [x] `tools/call` for `ping` with `{"message":"hi"}` returns text `pong: hi`
- [x] Nothing other than MCP messages is written to stdout

## Manual (real client)

- [ ] `claude mcp add` registers the server and Claude Code lists `ping`
- [ ] Asking Claude to "ping the gtm-copilot server" returns `pong`

## Hygiene

- [x] `package.json` has no `^` or `~` version ranges
- [x] `node_modules`, `dist` and `.env` are git-ignored
- [ ] `roadmap.md` Phase 1 is marked done
