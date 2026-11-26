import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { type AuthRejectionLimiter, clientKeyOf, createAuthRejectionLimiter } from "./auth-limiter.ts";
import { connectDoc } from "./connect-doc.ts";
import type { Config } from "./env.ts";
import { buildMcpServer } from "./mcp-server.ts";
import { createApi, type Timing } from "./upstream.ts";

export const API_KEY_PREFIX = "ms_live_";

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";
const OPENID_CONFIGURATION_PATH = "/.well-known/openid-configuration";
const DISCOVERY_CACHE = "public, max-age=3600, s-maxage=3600";
const UNCOUNTED_PROBE_METHODS = new Set(["GET", "HEAD"]);

type Env = { Variables: { credential: string } };

export interface AppDeps {
  config: Config;
  fetch?: typeof fetch;
  timing?: Timing;
  authLimiter?: AuthRejectionLimiter;
}

type Refusal = "missing" | "invalid";

function credentialOf(c: Context<Env>): string | undefined {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || undefined;
  return c.req.header("x-api-key")?.trim() || undefined;
}

async function liveSession(fetchImpl: typeof fetch, sessionUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetchImpl(sessionUrl, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { userId?: unknown } | null;
    return typeof body?.userId === "string" && body.userId.length > 0;
  } catch {
    return false;
  }
}

async function upstreamJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function wellKnownPaths(base: string): string[] {
  return [base, `${base}/mcp`];
}

function requireCredential(deps: Required<Pick<AppDeps, "config" | "fetch" | "authLimiter">>) {
  const { config, authLimiter } = deps;
  const challenge = `Bearer realm="modelstill", resource_metadata="${config.publicUrl}${PROTECTED_RESOURCE_PATH}"`;
  const sessionUrl = `${config.apiUrl}/api/auth/mcp/get-session`;

  const bodies: Record<Refusal, Record<string, string>> = {
    missing: {
      error: "unauthorized",
      hint: `No credentials were sent. Connect with OAuth, or send a ModelStill API key (${API_KEY_PREFIX}...) as an Authorization: Bearer header or an x-api-key header.`,
      docs_url: config.docsUrl,
    },
    invalid: {
      error: "invalid_token",
      hint: `The access token is invalid or expired. Reconnect to sign in again, or send a ModelStill API key (${API_KEY_PREFIX}...).`,
      docs_url: config.docsUrl,
    },
  };

  function refuse(c: Context<Env>, reason: Refusal) {
    const challenged = { "WWW-Authenticate": challenge, "Cache-Control": "no-store" };
    if (reason === "missing" && UNCOUNTED_PROBE_METHODS.has(c.req.method)) return c.json(bodies[reason], 401, challenged);
    const decision = authLimiter.reject(clientKeyOf(c.req.raw));
    if (!decision.allowed) {
      return c.json(
        {
          error: "rate_limited",
          hint: `Too many requests without valid credentials. Retry in ${decision.retryAfterSec} s with an API key or an OAuth token.`,
          docs_url: config.docsUrl,
        },
        429,
        { ...challenged, "Retry-After": String(decision.retryAfterSec) },
      );
    }
    return c.json(bodies[reason], 401, challenged);
  }

  return createMiddleware<Env>(async (c, next) => {
    const credential = credentialOf(c);
    if (!credential) return refuse(c, "missing");
    if (!credential.startsWith(API_KEY_PREFIX) && !(await liveSession(deps.fetch, sessionUrl, credential))) {
      return refuse(c, "invalid");
    }
    c.set("credential", credential);
    await next();
  });
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { config } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const authLimiter =
    deps.authLimiter ?? createAuthRejectionLimiter({ limit: config.unauthLimit, windowMs: config.unauthWindowMs });
  const authGate = requireCredential({ config, fetch: fetchImpl, authLimiter });
  const app = new Hono<Env>();

  app.use(
    cors({
      origin: (origin) => origin,
      allowHeaders: ["Content-Type", "Authorization", "x-api-key", "mcp-protocol-version", "mcp-session-id"],
      allowMethods: ["POST", "GET", "OPTIONS", "DELETE"],
      exposeHeaders: ["mcp-session-id", "WWW-Authenticate"],
    }),
  );

  app.get("/healthz", (c) => c.text("ok"));
  app.get("/readiness", (c) => c.text("ok"));
  app.get("/docs", (c) => c.text(connectDoc(config.publicUrl)));

  for (const path of wellKnownPaths(PROTECTED_RESOURCE_PATH)) {
    app.get(path, async (c) => {
      const body = await upstreamJson(fetchImpl, `${config.apiUrl}/api/auth${PROTECTED_RESOURCE_PATH}`);
      if (!body) return c.json({ error: "Discovery metadata is unavailable" }, 502);
      return c.json(
        { ...body, resource: config.publicUrl, resource_name: "ModelStill", resource_documentation: config.docsUrl },
        200,
        { "Cache-Control": DISCOVERY_CACHE },
      );
    });
  }

  for (const base of [AUTHORIZATION_SERVER_PATH, OPENID_CONFIGURATION_PATH]) {
    for (const path of wellKnownPaths(base)) {
      app.get(path, async (c) => {
        const body = await upstreamJson(fetchImpl, `${config.apiUrl}/api/auth${AUTHORIZATION_SERVER_PATH}`);
        if (!body) return c.json({ error: "Discovery metadata is unavailable" }, 502);
        return c.json(body, 200, { "Cache-Control": DISCOVERY_CACHE });
      });
    }
  }

  app.post("/mcp", authGate, async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const api = createApi({ baseUrl: config.apiUrl, credential: c.get("credential"), fetch: fetchImpl, timing: deps.timing });
    const server = buildMcpServer(api);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, { parsedBody: body });
    } finally {
      void transport.close();
      void server.close();
    }
  });

  app.on(["GET", "DELETE"], "/mcp", authGate, (c) =>
    c.json({ error: "Method Not Allowed. Use POST for JSON-RPC." }, 405, { Allow: "POST", "Cache-Control": "no-store" }),
  );

  app.onError((error, c) => {
    console.error("unhandled error", error instanceof Error ? error.message : String(error));
    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  return app;
}
