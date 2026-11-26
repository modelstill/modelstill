import { beforeEach, describe, expect, test } from "bun:test";
import { ADMIN_TOKEN, API_ORIGIN, DASHBOARD_ORIGIN, authFixture, taskBody } from "./auth-fixture.ts";

let fx: ReturnType<typeof authFixture>;

beforeEach(() => {
  fx = authFixture();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function putTask(headers: Record<string, string>) {
  return fx.call("/v1/tasks/t", fx.json("PUT", taskBody, headers));
}

describe("reads need a credential", () => {
  test("an anonymous read is refused with a pointer to the OAuth metadata", async () => {
    const response = await fx.call("/v1/tasks");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${API_ORIGIN}/.well-known/oauth-protected-resource"`,
    );
  });

  test("health stays open", async () => {
    expect((await fx.call("/health")).status).toBe(200);
  });

  test("a wrong bearer token is refused", async () => {
    expect((await fx.call("/v1/tasks", { headers: bearer("nope") })).status).toBe(401);
    expect((await fx.call("/v1/tasks", { headers: bearer("ms_live_nope") })).status).toBe(401);
  });

  test("the review decision route is guarded", async () => {
    const response = await fx.call(
      "/v1/review-queue/item-1/decision",
      fx.json("POST", { verdict: "accept", reviewer: "a" }),
    );
    expect(response.status).toBe(401);
  });

  test("the bulk review decision route is guarded", async () => {
    const response = await fx.call(
      "/v1/review-queue/decisions",
      fx.json("POST", { itemIds: ["item-1"], verdict: "accept", reviewer: "a" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("the admin token", () => {
  test("reads and writes", async () => {
    expect((await fx.call("/v1/tasks", { headers: bearer(ADMIN_TOKEN) })).status).toBe(200);
    expect((await putTask(bearer(ADMIN_TOKEN))).status).toBe(200);
  });
});

describe("a dashboard session", () => {
  test("signs in with an emailed code, then reads and writes with the cookie", async () => {
    const cookie = await fx.signIn();
    expect((await fx.call("/v1/tasks", { headers: { cookie } })).status).toBe(200);
    expect((await putTask({ cookie })).status).toBe(200);
  });

  test("a dataset change made from the dashboard is signed with the user's email", async () => {
    const cookie = await fx.signIn();
    await putTask({ cookie });
    const created = await fx.call("/v1/tasks/t/datasets", fx.json("POST", { name: "gold", rows: [{ id: "a", input: "x" }] }, { cookie }));
    expect((await created.json()).dataset.version.author).toBe("owner@example.com");
  });

  test("get-session answers without signing a JWT, so a rotated secret cannot break it", async () => {
    const cookie = await fx.signIn();
    const response = await fx.call("/api/auth/get-session", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-auth-jwt")).toBeNull();
    expect(((await response.json()) as { user: { email: string } }).user.email).toBe("owner@example.com");
  });

  test("a wrong code does not sign in", async () => {
    await fx.requestCode("owner@example.com");
    const response = await fx.call(
      "/api/auth/sign-in/email-otp",
      fx.json("POST", { email: "owner@example.com", otp: "000000" }),
    );
    expect(response.headers.get("set-cookie") ?? "").not.toContain("session_token=");
  });

  test("CORS lets the dashboard send its cookie", async () => {
    const response = await fx.call("/v1/tasks", {
      method: "OPTIONS",
      headers: { origin: DASHBOARD_ORIGIN, "access-control-request-method": "GET" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(DASHBOARD_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("allowed emails", () => {
  test("only listed emails and domains get a code", async () => {
    fx = authFixture({ allowedEmails: ["owner@example.com", "@team.dev"] });
    expect((await fx.requestCode("stranger@else.com")).status).toBe(403);
    expect(fx.codes.has("stranger@else.com")).toBe(false);
    expect((await fx.requestCode("owner@example.com")).status).toBe(200);
    expect((await fx.requestCode("anyone@team.dev")).status).toBe(200);
  });
});

describe("API keys", () => {
  test("a session creates a key shown once with the ms_live_ prefix", async () => {
    const cookie = await fx.signIn();
    const { status, body } = await fx.createKey(cookie, "write");
    expect(status).toBe(201);
    expect(String(body["key"])).toStartWith("ms_live_");
    expect(body["permission"]).toBe("write");
    expect(body["name"]).toBe("laptop");
  });

  test("only a session can create a key", async () => {
    const cookie = await fx.signIn();
    const { body } = await fx.createKey(cookie, "write");
    const key = String(body["key"]);
    const byKey = await fx.call("/v1/api-keys", fx.json("POST", { name: "x", permission: "read" }, bearer(key)));
    expect(byKey.status).toBe(403);
    const byAdmin = await fx.call("/v1/api-keys", fx.json("POST", { name: "x", permission: "read" }, bearer(ADMIN_TOKEN)));
    expect(byAdmin.status).toBe(403);
    expect((await fx.call("/v1/api-keys", fx.json("POST", { name: "x", permission: "read" }))).status).toBe(401);
  });

  test("a read key reads but cannot write", async () => {
    const cookie = await fx.signIn();
    const key = String((await fx.createKey(cookie, "read")).body["key"]);
    expect((await fx.call("/v1/tasks", { headers: bearer(key) })).status).toBe(200);
    expect((await fx.call("/v1/tasks", { headers: { "x-api-key": key } })).status).toBe(200);
    const refused = await putTask(bearer(key));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
  });

  test("a write key writes, by bearer or x-api-key", async () => {
    const cookie = await fx.signIn();
    const key = String((await fx.createKey(cookie, "write")).body["key"]);
    expect((await putTask(bearer(key))).status).toBe(200);
    expect((await putTask({ "x-api-key": key })).status).toBe(200);
  });

  test("a revoked key stops working", async () => {
    const cookie = await fx.signIn();
    const created = await fx.createKey(cookie, "read");
    const key = String(created.body["key"]);
    const revoked = await fx.call("/api/auth/api-key/delete", fx.json("POST", { keyId: created.body["id"] }, { cookie }));
    expect(revoked.status).toBe(200);
    expect((await fx.call("/v1/tasks", { headers: bearer(key) })).status).toBe(401);
  });

  test("a key needs a name and a known permission", async () => {
    const cookie = await fx.signIn();
    const response = await fx.call("/v1/api-keys", fx.json("POST", { name: "", permission: "admin" }, { cookie }));
    expect(response.status).toBe(400);
  });
});

describe("MCP OAuth", () => {
  test("an authorize request without a session goes to the dashboard login with the query", async () => {
    const query = new URLSearchParams({ client_id: "c", response_type: "code", redirect_uri: "http://x/cb", prompt: "consent" });
    const response = await fx.call(`/api/auth/mcp/authorize?${query}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${DASHBOARD_ORIGIN}/login`);
    expect(location.searchParams.get("client_id")).toBe("c");
  });

  test("an authorize request always asks for consent", async () => {
    const query = new URLSearchParams({ client_id: "c", response_type: "code", redirect_uri: "http://x/cb" });
    const response = await fx.call(`/api/auth/mcp/authorize?${query}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/api/auth/mcp/authorize");
    expect(location.searchParams.get("prompt")).toBe("consent");
    expect(location.searchParams.get("client_id")).toBe("c");
  });

  test("a read token reads but cannot write", async () => {
    const cookie = await fx.signIn();
    const token = await fx.oauthToken(cookie, "openid modelstill:read");
    expect((await fx.call("/v1/tasks", { headers: bearer(token) })).status).toBe(200);
    const refused = await putTask(bearer(token));
    expect(refused.status).toBe(403);
    expect(refused.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope", scope="modelstill:write"');
  });

  test("a write token writes", async () => {
    const cookie = await fx.signIn();
    const token = await fx.oauthToken(cookie, "openid modelstill:read modelstill:write");
    expect((await putTask(bearer(token))).status).toBe(200);
  });

  test("a token without a modelstill scope cannot read", async () => {
    const cookie = await fx.signIn();
    const token = await fx.oauthToken(cookie, "openid profile");
    const refused = await fx.call("/v1/tasks", { headers: bearer(token) });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope", scope="modelstill:read"');
  });

  test("the MCP server verifies a token at get-session and never sees the refresh token", async () => {
    const cookie = await fx.signIn();
    const token = await fx.oauthToken(cookie, "openid modelstill:read");
    const response = await fx.call("/api/auth/mcp/get-session", { headers: bearer(token) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["userId"]).toBeString();
    expect(body["clientId"]).toBeString();
    expect(body["scopes"]).toBe("openid modelstill:read");
    expect(body["accessTokenExpiresAt"]).toBeString();
    expect(body).not.toHaveProperty("refreshToken");
    const unknown = await fx.call("/api/auth/mcp/get-session", { headers: bearer("not-a-token") });
    expect(await unknown.json()).toBeNull();
  });
});

describe("discovery", () => {
  const scopes = ["openid", "profile", "email", "offline_access", "modelstill:read", "modelstill:write"];

  test("the authorization server metadata lists the modelstill scopes at both well-known paths", async () => {
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const response = await fx.call(path);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body["issuer"]).toBe(API_ORIGIN);
      expect(body["authorization_endpoint"]).toBe(`${API_ORIGIN}/api/auth/mcp/authorize`);
      expect(body["token_endpoint"]).toBe(`${API_ORIGIN}/api/auth/mcp/token`);
      expect(body["registration_endpoint"]).toBe(`${API_ORIGIN}/api/auth/mcp/register`);
      expect(body["scopes_supported"]).toEqual(scopes);
    }
  });

  test("the protected resource metadata names the MCP server and this issuer", async () => {
    const response = await fx.call("/.well-known/oauth-protected-resource");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["resource"]).toBe("http://localhost:3104/mcp");
    expect(body["authorization_servers"]).toEqual([API_ORIGIN]);
    expect(body["scopes_supported"]).toEqual(scopes);
  });

  test("the advertised jwks_uri answers", async () => {
    const response = await fx.call("/api/auth/mcp/jwks");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { keys: unknown[] }).keys).toBeArray();
  });

  test("the API reference is served by Scalar", async () => {
    const response = await fx.call("/docs/reference");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("/openapi.json");
  });

  test("the OpenAPI document lists the key route and the security schemes", async () => {
    const body = (await (await fx.call("/openapi.json")).json()) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(body.paths["/v1/api-keys"]?.["post"]).toBeDefined();
    expect(body.components.securitySchemes["apiKeyHeader"]).toMatchObject({ type: "apiKey", in: "header", name: "x-api-key" });
    expect(body.paths["/v1/tasks"]?.["get"]?.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
  });
});
