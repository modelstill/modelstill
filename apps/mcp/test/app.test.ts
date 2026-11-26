import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { createAuthRejectionLimiter } from "../src/auth-limiter.ts";
import { readConfig } from "../src/env.ts";
import { instantTiming, stubFetch, stubRoutes, type StubbedFetch } from "./stub.ts";

const config = readConfig({ MODELSTILL_API_URL: "http://api.test", PUBLIC_URL: "https://mcp.example.test" });
const RESOURCE_METADATA = "https://mcp.example.test/.well-known/oauth-protected-resource";

function appWith(stub: StubbedFetch, limit = 30) {
  return createApp({
    config,
    fetch: stub.fetch,
    timing: instantTiming().timing,
    authLimiter: createAuthRejectionLimiter({ limit, windowMs: 60_000 }),
  });
}

function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request("http://mcp.local/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0.0.0" },
};

const SESSION_PATH = "GET /api/auth/mcp/get-session";

describe("health", () => {
  test("/healthz and /readiness answer ok without credentials", async () => {
    const app = appWith(stubRoutes({}));
    expect(await (await app.request("/healthz")).text()).toBe("ok");
    expect(await (await app.request("/readiness")).text()).toBe("ok");
  });
});

describe("auth", () => {
  test("no credentials is a 401 with the OAuth challenge and a JSON hint", async () => {
    const res = await appWith(stubRoutes({})).fetch(rpc("initialize", INITIALIZE));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer realm="modelstill", resource_metadata="${RESOURCE_METADATA}"`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["docs_url", "error", "hint"]);
    expect(body["error"]).toBe("unauthorized");
    expect(String(body["hint"])).toContain("ms_live_");
  });

  test("an API key in Authorization is passed through to the API without an OAuth check", async () => {
    const stub = stubRoutes({ "GET /v1/tasks": { status: 200, body: { tasks: [] } } });
    const res = await appWith(stub).fetch(rpc("tools/call", { name: "list_tasks", arguments: {} }, { authorization: "Bearer ms_live_key" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { structuredContent: unknown } };
    expect(body.result.structuredContent).toEqual({ tasks: [] });
    expect(stub.requests.map((r) => [r.path, r.authorization])).toEqual([["/v1/tasks", "Bearer ms_live_key"]]);
  });

  test("an API key in x-api-key works too", async () => {
    const stub = stubRoutes({ "GET /v1/tasks": { status: 200, body: { tasks: [] } } });
    const res = await appWith(stub).fetch(rpc("tools/call", { name: "list_tasks", arguments: {} }, { "x-api-key": "ms_live_key" }));
    expect(res.status).toBe(200);
    expect(stub.requests[0]?.authorization).toBe("Bearer ms_live_key");
  });

  test("an OAuth token is checked against the API's MCP session and then forwarded", async () => {
    const stub = stubRoutes({
      [SESSION_PATH]: { status: 200, body: { userId: "user-1" } },
      "GET /v1/tasks": { status: 200, body: { tasks: [] } },
    });
    const res = await appWith(stub).fetch(rpc("tools/call", { name: "list_tasks", arguments: {} }, { authorization: "Bearer oauth-token" }));
    expect(res.status).toBe(200);
    expect(stub.requests.map((r) => [r.path, r.authorization])).toEqual([
      ["/api/auth/mcp/get-session", "Bearer oauth-token"],
      ["/v1/tasks", "Bearer oauth-token"],
    ]);
  });

  test("an OAuth token with no live session is a 401", async () => {
    const stub = stubRoutes({ [SESSION_PATH]: { status: 200, body: null } });
    const res = await appWith(stub).fetch(rpc("initialize", INITIALIZE, { authorization: "Bearer stale" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(((await res.json()) as Record<string, unknown>)["error"]).toBe("invalid_token");
  });

  test("an unreachable auth server is a 401, not a crash", async () => {
    const failing = { fetch: (async () => { throw new TypeError("down"); }) as unknown as typeof fetch, requests: [] };
    const res = await appWith(failing).fetch(rpc("initialize", INITIALIZE, { authorization: "Bearer t" }));
    expect(res.status).toBe(401);
  });

  test("past the burst of refusals a client gets 429 with Retry-After", async () => {
    const app = appWith(stubRoutes({}), 2);
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 3; i++) {
      last = await app.fetch(rpc("initialize", INITIALIZE, { "x-forwarded-for": "9.9.9.9" }));
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 429]);
    expect(last?.headers.get("retry-after")).toBe("60");
    expect(last?.headers.get("www-authenticate")).toContain("Bearer");
  });

  test("a bare GET probe without credentials is answered 401 but not counted", async () => {
    const app = appWith(stubRoutes({}), 1);
    for (let i = 0; i < 3; i++) expect((await app.request("/mcp")).status).toBe(401);
    expect((await app.fetch(rpc("initialize", INITIALIZE))).status).toBe(401);
  });
});

describe("/mcp", () => {
  test("initialize answers with the server name and instructions as JSON", async () => {
    const res = await appWith(stubRoutes({})).fetch(rpc("initialize", INITIALIZE, { authorization: "Bearer ms_live_key" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = (await res.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(body.result.serverInfo.name).toBe("modelstill");
    expect(body.result.instructions).toContain("list_tasks");
  });

  test("tools/list works without a session", async () => {
    const res = await appWith(stubRoutes({})).fetch(rpc("tools/list", {}, { authorization: "Bearer ms_live_key" }));
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(14);
  });

  test("GET and DELETE with credentials are 405", async () => {
    const app = appWith(stubRoutes({}));
    for (const method of ["GET", "DELETE"]) {
      const res = await app.request("/mcp", { method, headers: { authorization: "Bearer ms_live_key" } });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});

describe("discovery", () => {
  const upstream = () =>
    stubFetch((request) => {
      if (request.path === "/api/auth/.well-known/oauth-protected-resource") {
        return { status: 200, body: { resource: "http://api.test", authorization_servers: ["http://api.test"] } };
      }
      if (request.path === "/api/auth/.well-known/oauth-authorization-server") {
        return { status: 200, body: { issuer: "http://api.test", authorization_endpoint: "http://api.test/api/auth/mcp/authorize" } };
      }
      return { status: 404, body: {} };
    });

  test("protected-resource metadata comes from the API, naming this server as the resource", async () => {
    const app = appWith(upstream());
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: "https://mcp.example.test",
        authorization_servers: ["http://api.test"],
        resource_name: "ModelStill",
        resource_documentation: "https://mcp.example.test/docs",
      });
    }
  });

  test("authorization-server and openid metadata are mirrored from the API, also under /mcp", async () => {
    const app = appWith(upstream());
    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/mcp",
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/mcp",
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Record<string, unknown>)["issuer"]).toBe("http://api.test");
    }
  });

  test("metadata the API cannot give is a 502", async () => {
    const res = await appWith(stubRoutes({})).request("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(502);
  });

  test("/docs explains how to connect", async () => {
    const text = await (await appWith(stubRoutes({})).request("/docs")).text();
    expect(text).toContain("https://mcp.example.test/mcp");
    expect(text).toContain("ms_live_");
  });
});
