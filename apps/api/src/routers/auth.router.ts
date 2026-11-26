import { Hono } from "hono";
import type { Auth } from "../auth/index.ts";
import { AUTH_BASE_PATH } from "../auth/index.ts";
import { dashboardPage } from "../auth/mcp-oauth.ts";
import { OAUTH_SCOPES } from "../auth/oauth-scopes.ts";

function rewrite(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, { headers: request.headers });
}

function needsConsent(prompt: string | null): boolean {
  return !(prompt ?? "").split(/\s+/).includes("consent");
}

async function withOurScopes(response: Response): Promise<Response> {
  const metadata = (await response.json()) as Record<string, unknown> | null;
  if (!metadata) return Response.json(null, { status: response.status });
  return Response.json({ ...metadata, scopes_supported: [...OAUTH_SCOPES] }, { status: response.status });
}

export function createAuthRouter(auth: Auth, frontendUrl: string) {
  const authorizationServer = (request: Request) =>
    auth.handler(rewrite(request, `${AUTH_BASE_PATH}/.well-known/oauth-authorization-server`)).then(withOurScopes);

  return new Hono()
    .get("/.well-known/oauth-authorization-server", (c) => authorizationServer(c.req.raw))
    .get("/.well-known/openid-configuration", (c) => authorizationServer(c.req.raw))
    .get("/.well-known/oauth-protected-resource", (c) =>
      auth.handler(rewrite(c.req.raw, `${AUTH_BASE_PATH}/.well-known/oauth-protected-resource`)),
    )
    .get(`${AUTH_BASE_PATH}/mcp/authorize`, async (c) => {
      const url = new URL(c.req.url);
      if (needsConsent(url.searchParams.get("prompt"))) {
        url.searchParams.set("prompt", "consent");
        return c.redirect(url.toString(), 302);
      }
      const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
      if (!session) return c.redirect(`${dashboardPage(frontendUrl, "/login")}?${url.searchParams.toString()}`, 302);
      return auth.handler(c.req.raw);
    })
    .get(`${AUTH_BASE_PATH}/mcp/jwks`, (c) => auth.handler(rewrite(c.req.raw, `${AUTH_BASE_PATH}/jwks`)))
    .get(`${AUTH_BASE_PATH}/mcp/get-session`, async (c) => {
      const response = await auth.handler(c.req.raw);
      const token = (await response.json()) as Record<string, unknown> | null;
      if (!token) return c.json(null, 200);
      const { refreshToken: _refreshToken, refreshTokenExpiresAt: _refreshTokenExpiresAt, ...visible } = token;
      return c.json(visible, 200);
    })
    .on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));
}
