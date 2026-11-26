# 0013. Expose ModelStill to agents through a stateless MCP server that only calls the API

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** maintainers

## Context

Agents (Claude Code, Claude, Cursor) need to read task state and make two decisions a person makes
today in the dashboard: accept or correct a review item, and switch a task's serving mode. A
stateless MCP server in front of an HTTP API is a shape the maintainers have run in production
with several MCP clients. Better Auth, with API keys (`ms_live_`) and its MCP OAuth plugin at
`/api/auth/*`, is being added to the API at the same time.

## Decision

- `apps/mcp` is a separate service on port 3104. It reads and writes only through the ModelStill
  HTTP API, forwarding the caller's bearer; it has no database or ClickHouse access.
- Transport is Streamable HTTP, stateless: every `POST /mcp` builds a new `McpServer` and a
  `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator: undefined` and JSON
  responses. `GET` and `DELETE /mcp` answer 405. It runs on `Bun.serve`, like `apps/api`.
- `ms_live_` keys pass through unchecked; any other bearer is an OAuth token checked at
  `/api/auth/mcp/get-session`. OAuth discovery documents are proxied from the API.
- Reads are retried on 429 (3 attempts, 8 s in all). Writes are never retried by the server.
- Pins: `@modelcontextprotocol/sdk` 1.32.0, `hono` 4.13.16 (as `apps/api`), `zod` 3.25.32 (tool
  schemas use its `zod/v4` entry).

## Consequences

- Every permission rule lives in the API; the MCP server cannot grant more than the credential
  allows. A tool that needs data the API does not serve needs an API endpoint first.
- No session state means any replica answers any request and restarts lose nothing. The cost is
  one OAuth check per request for token callers.
- The unauthenticated limiter is in memory per replica; N replicas allow N times the limit.
- Until the API serves `/api/auth/mcp/get-session`, only `ms_live_` keys work.

## Alternatives considered

- Tools inside `apps/api`: would put MCP protocol and per-request server construction in the API
  process and tie both deploys together.
- Sessionful transport: needs sticky routing or shared session storage for no feature we use.
- `@hono/node-server`: this repo runs its TypeScript services on Bun, and the SDK's web-standard
  transport works there without Node request objects.

## Links

- Runbooks: `../runbooks/mcp.md`
- Code: `apps/mcp/src/`
