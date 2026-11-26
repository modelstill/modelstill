# 0011. Authenticate the API and dashboard with Better Auth

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** maintainers

## Context

Until now the API had one shared bearer token, `MODELSTILL_API_TOKEN`. It guarded writes, reads
were open unless `MODELSTILL_API_PROTECT_READS` was set, and `POST /v1/review-queue/{itemId}/decision`
was not guarded at all. The dashboard sent no credentials. An MCP server (port 3104) is being added
and needs a way for MCP clients to sign in and for the server to check their tokens.

Better Auth 1.6.19 offers email OTP, API keys and an MCP OAuth provider as plugins. The maintainers
had run that combination in production before, and the gaps found there shape the choices below.

## Decision

The API runs Better Auth 1.6.19 at `/api/auth/*`, Postgres-backed through the drizzle adapter
(`auth_*` tables, migration `0003_auth`) and in memory when `DATABASE_URL` is unset. Every `/v1`
route needs one of these, checked in this order by `apps/api/src/auth/caller.ts`:

| Credential | Sent as | Reads | Writes |
|---|---|---|---|
| Admin token | `Authorization: Bearer $MODELSTILL_API_TOKEN` | yes | yes |
| API key | `Authorization: Bearer ms_live_...` or `x-api-key: ms_live_...` | `read` or `write` permission | `write` permission |
| MCP OAuth access token | `Authorization: Bearer <token>` | `modelstill:read` or `modelstill:write` | `modelstill:write` |
| Dashboard session | `better-auth.session_token` cookie | yes | yes |

No credential is a 401 with `WWW-Authenticate: Bearer resource_metadata="<api>/.well-known/oauth-protected-resource"`.
A credential without the permission is a 403 `{"error":"forbidden"}`; for OAuth the header is
`Bearer error="insufficient_scope", scope="modelstill:write"` (or `modelstill:read`).

The setup:

- The plugin set `mcp(mcpOAuthOptions(...))`, `emailOTP`, `apiKey` from `@better-auth/api-key` with
  a `defaultPrefix`, `jwt`, `openAPI` (`apps/api/src/auth/index.ts`, `mcp-oauth.ts`, `oauth-scopes.ts`).
- The middleware shape: a session, then a key read from Bearer or `x-api-key`, then
  `auth.api.getMcpSession` for OAuth, recording `authType` as `session`, `api_key` or `oauth`
  (plus `token` for the admin token).
- Well-known documents are served at the root by delegating to `/api/auth/.well-known/*`, not by
  redirect, because some MCP clients do not follow redirects. `/.well-known/openid-configuration`
  serves the same document as `/.well-known/oauth-authorization-server`.
- `/api/auth/mcp/jwks` is delegated to `/api/auth/jwks`, because the plugin advertises the former
  and serves the latter.
- An authorize gate sits in front of `/api/auth/mcp/authorize`. Without one, a signed-in user's
  browser could be sent to authorize and hand a code to any registered client. Here every
  authorize request is redirected to add `prompt=consent`, so it always passes the dashboard's
  `/oauth/consent` page, and a signed-out request goes straight to the dashboard `/login` with its
  query, which sends the user back to authorize after the code is entered.
- Scalar (`@scalar/hono-api-reference` 0.7.5) at `/docs/reference`, reading `/openapi.json`.
- The error shape in `app.onError`: `HTTPException` becomes `{"error": message}`.
- Dashboard: server-side session check in the layout with a redirect to `/login`, the Better Auth
  client with `apiKeyClient`, the API keys page (create with the key shown once and a copy button,
  list, revoke behind an AlertDialog) and the MCP connect page.

Choices worth noting:

- API key permissions are set by the server. Better Auth refuses `permissions` from a client, so
  the dashboard creates keys through `POST /v1/api-keys` (session only), which calls
  `auth.api.createApiKey` with `{"modelstill": ["read"]}` or `{"modelstill": ["read", "write"]}`.
  Listing and revoking go through the Better Auth client.
- PKCE is required (`requirePKCE: true`). This server has no old clients to keep working.
- `GET /api/auth/mcp/get-session` is wrapped to drop `refreshToken` and `refreshTokenExpiresAt`, so the
  MCP server never holds a refresh token it does not need.
- The `jwt` plugin is on with `disableSettingJwtHeader`. With the header on, every get-session signed
  a JWT with a key encrypted under the secret that created it; a different `BETTER_AUTH_SECRET`
  turned get-session into a 500 and locked every session out (seen on 2026-11-24 when a Postgres
  test left a key behind).
- Sign-in codes are logged by the API (`[auth] sign-in code for <email>: <code>`); no email is sent.
  `MODELSTILL_ALLOWED_EMAILS` (addresses or `@domain` entries) limits who can get a code or be created.
- Tables are prefixed `auth_` so they cannot collide with ModelStill's own.
- `MODELSTILL_API_PROTECT_READS` is removed: reads are always protected.

Left out on purpose: billing, organizations and workspaces, SSO, passkeys, two factor, admin,
generic OAuth providers, captcha, disposable email checks, i18n, Redis secondary storage and rate
limiting beyond Better Auth's defaults.

## Consequences

- The Python push and console code keep working unchanged: they send `MODELSTILL_API_TOKEN`, which
  stays a full read and write credential. Anything that read the API without a token before now gets
  a 401 and needs a key.
- The dashboard cookie is set by the API host. The dashboard and API must be same-site (the same
  registrable domain, as `localhost:4323` and `localhost:8787` are) for the cookie to reach both;
  CORS allows credentials only for `CORS_ORIGINS`.
- The dashboard layout treats an API that cannot be reached, or answers 5xx, as "unreachable" and
  renders the shell so the pages can show their own errors. The API is the security boundary; the
  layout only spares a signed-out user an empty dashboard.
- Production needs a real mailer before anyone other than the operator signs in, and a stable
  `BETTER_AUTH_SECRET`; rotating it means deleting `auth_jwks` rows.
- The decision stops holding if the dashboard and API move to different sites (then the session needs
  bearer tokens instead of a cookie) or if Better Auth's mcp plugin is replaced by its newer OAuth
  provider package.

## Alternatives considered

- Keep the shared token and add per-user tokens by hand: no login, no MCP OAuth, and rebuilding what
  Better Auth already provides.
- Better Auth's bearer plugin for the dashboard instead of cookies: the dashboard would hold the
  session token in script-readable storage; cookies keep it HttpOnly.
- Email and password: one more secret to store and reset; a one-time code needs neither.

## Links

- Runbooks: `../runbooks/auth-and-api-keys.md`
- Code: `apps/api/src/auth/`, `apps/api/src/routers/auth.router.ts`, `apps/api/src/db/auth-schema.ts`,
  `apps/api/drizzle/0003_auth.sql`, `apps/website/src/app/(dashboard)/layout.tsx`,
  `apps/website/src/app/login/`, `apps/website/src/app/oauth/consent/`,
  `apps/website/src/app/(dashboard)/settings/api-keys/`, `apps/website/src/app/(dashboard)/connect/`
