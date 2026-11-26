# Auth, API keys and MCP sign-in

How people, scripts and MCP clients authenticate to the ModelStill API. The design is in
[ADR 0011](../decisions/0011-auth-better-auth.md).

## Environment

API (`apps/api/.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | unset: users, sessions and keys live in memory and vanish on restart | Postgres for the store and the `auth_*` tables |
| `MODELSTILL_API_TOKEN` | unset | admin and automation credential with full read and write |
| `BETTER_AUTH_SECRET` | Better Auth's development secret | signs cookies and encrypts the JWT key set; set a random 32+ character value everywhere but a throwaway local run |
| `BETTER_AUTH_URL` | `http://localhost:$PORT` | the API's public origin; the OAuth issuer |
| `FRONTEND_URL` | `http://localhost:4323` | the dashboard; `/login` and `/oauth/consent` live there |
| `CORS_ORIGINS` | the dashboard origin and `http://localhost:3000` | origins allowed to call with cookies |
| `TRUSTED_ORIGINS` | none | extra origins Better Auth accepts for sign-in calls |
| `MCP_RESOURCE_URL` | `http://localhost:3104/mcp` | the MCP server, named as `resource` in the protected resource metadata |
| `MODELSTILL_ALLOWED_EMAILS` | anyone | comma list of addresses and `@domain` entries allowed to sign in |

Dashboard (`apps/website/.env.example`): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MCP_URL`
(default `http://localhost:3104/mcp`), and `API_INTERNAL_URL` when the dashboard server reaches the API
on a different address than the browser does.

## First user and first key, locally

```sh
cd apps/api
DATABASE_URL=postgres://postgres:postgres@localhost:5434/modelstill bunx drizzle-kit migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5434/modelstill \
  BETTER_AUTH_SECRET=$(openssl rand -hex 32) MODELSTILL_API_TOKEN=$(openssl rand -hex 16) \
  bun run dev
cd ../website && bun run dev
```

1. Open `http://localhost:4323`. Every page sends you to `/login`.
2. Enter your email and press Send code. No email is sent: the API prints
   `[auth] sign-in code for you@example.com: 123456`. Enter the code. The first sign-in creates the user.
3. Open Settings (sidebar) and create a key with a name and Read only or Read and write. Copy it now;
   only its first characters are stored in a readable form.
4. Check it:

```sh
export MODELSTILL_API_KEY=ms_live_...
curl http://localhost:8787/v1/tasks -H "Authorization: Bearer $MODELSTILL_API_KEY"
```

Without the dashboard, the same steps by hand:

```sh
API=http://localhost:8787; ORIGIN=http://localhost:4323
curl -s -X POST $API/api/auth/email-otp/send-verification-otp -H "origin: $ORIGIN" \
  -H 'content-type: application/json' -d '{"email":"you@example.com","type":"sign-in"}'
curl -s -c jar.txt -X POST $API/api/auth/sign-in/email-otp -H "origin: $ORIGIN" \
  -H 'content-type: application/json' -d '{"email":"you@example.com","otp":"<code from the API log>"}'
curl -s -b jar.txt -X POST $API/v1/api-keys -H "origin: $ORIGIN" \
  -H 'content-type: application/json' -d '{"name":"laptop","permission":"write"}'
rm jar.txt
```

Revoke a key from Settings, or with `POST /api/auth/api-key/delete` `{"keyId": "..."}` and the
session cookie.

## Contract for the MCP server and other clients

- API keys start with `ms_live_`. Send `Authorization: Bearer ms_live_...` or `x-api-key: ms_live_...`.
  Keys carry `{"modelstill": ["read"]}` or `{"modelstill": ["read", "write"]}`.
- OAuth discovery: `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`
  (the same document), `/.well-known/oauth-protected-resource`. Endpoints are under `/api/auth/mcp/`:
  `register` (dynamic client registration), `authorize`, `token`, `userinfo`, `jwks`. PKCE S256 is
  required. Scopes: `openid profile email offline_access modelstill:read modelstill:write`.
- To check a bearer token the MCP server calls `GET <api>/api/auth/mcp/get-session` with the same
  `Authorization: Bearer <token>`. It answers 200 with `null` for an unknown or expired token, or
  `{"id", "accessToken", "accessTokenExpiresAt", "clientId", "userId", "scopes", "createdAt", "updatedAt"}`
  with `scopes` space separated. The refresh token is never returned.
- The MCP server forwards the caller's bearer (key or OAuth token) to `/v1/*`; the API applies the
  permission and scope rules itself.

## Troubleshooting

- Every request is 401 for a signed-in user, and `get-session` answers 500 with
  `Failed to decrypt private key`: the `auth_jwks` key set was made with another
  `BETTER_AUTH_SECRET`. Delete the rows in `auth_jwks`; a new key set is made on next use.
- The dashboard signs in but pages still go to `/login`: the cookie is not reaching the dashboard
  host. The dashboard and API must share a registrable domain, and the dashboard origin must be in
  `CORS_ORIGINS`.
- A send code call answers 403 `EMAIL_NOT_ALLOWED`: the address is not in `MODELSTILL_ALLOWED_EMAILS`.
