import { describe, expect, test } from "bun:test";
import { createApiClient } from "../src/lib/api";
import { createKeyCurl, createKeysApi, curlSample, maskedKey, toKeyRow } from "../src/lib/keys";
import { claudeCommand, cursorConfig, DEFAULT_MCP_URL, mcpJsonConfig, mcpUrl } from "../src/lib/mcp";
import { breadcrumbs, sectionForPath } from "../src/lib/nav";
import { pendingAuthorizeUrl, postSignInPath } from "../src/lib/oauth-return";
import { readSession } from "../src/lib/session";

const BASE = "http://api.test";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("readSession", () => {
  test("forwards the cookie to get-session and returns the user", async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), cookie: new Headers(init?.headers).get("cookie") });
      return jsonResponse({ user: { id: "u1", email: "a@b.co", name: "" }, session: { id: "s1" } });
    }) as typeof fetch;
    const state = await readSession({ apiUrl: BASE, cookie: "better-auth.session_token=abc", fetchImpl });
    expect(state).toEqual({ status: "signed-in", user: { id: "u1", email: "a@b.co", name: "", onboardedAt: null } });
    expect(seen).toEqual([{ url: `${BASE}/api/auth/get-session`, cookie: "better-auth.session_token=abc" }]);
  });

  test("no session is signed out, and no cookie skips the call", async () => {
    const fetchImpl = (async () => jsonResponse(null)) as unknown as typeof fetch;
    expect(await readSession({ apiUrl: BASE, cookie: "x=1", fetchImpl })).toEqual({ status: "signed-out" });
    const never = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    expect(await readSession({ apiUrl: BASE, cookie: "", fetchImpl: never })).toEqual({ status: "signed-out" });
  });

  test("an API that does not answer is unreachable, not signed out", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await readSession({ apiUrl: BASE, cookie: "x=1", fetchImpl: down })).toEqual({ status: "unreachable" });
    const broken = (async () => new Response("oops", { status: 502 })) as unknown as typeof fetch;
    expect(await readSession({ apiUrl: BASE, cookie: "x=1", fetchImpl: broken })).toEqual({ status: "unreachable" });
  });
});

describe("after signing in", () => {
  test("an MCP authorize request goes back to the API with its query", () => {
    const params = new URLSearchParams({ client_id: "c1", response_type: "code", scope: "openid modelstill:read" });
    expect(pendingAuthorizeUrl(params, BASE)).toBe(`${BASE}/api/auth/mcp/authorize?${params.toString()}`);
    expect(pendingAuthorizeUrl(new URLSearchParams({ client_id: "c1" }), BASE)).toBeNull();
  });

  test("goes to a safe next path or the task list", () => {
    expect(postSignInPath(new URLSearchParams({ next: "/settings/api-keys" }))).toBe("/settings/api-keys");
    expect(postSignInPath(new URLSearchParams({ next: "https://evil.example" }))).toBe("/tasks");
    expect(postSignInPath(new URLSearchParams({ next: "//evil.example" }))).toBe("/tasks");
    expect(postSignInPath(new URLSearchParams())).toBe("/tasks");
  });
});

describe("the API client", () => {
  test("sends the session cookie on every call", async () => {
    const inits: RequestInit[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init ?? {});
      return jsonResponse({ tasks: [] });
    }) as typeof fetch;
    await createApiClient({ baseUrl: BASE, fetchImpl }).listTasks();
    expect(inits[0]?.credentials).toBe("include");
  });

  test("a 401 tells the dashboard to sign in again", async () => {
    let signedOut = 0;
    const fetchImpl = (async () => jsonResponse({ error: "unauthorized" }, 401)) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: BASE, fetchImpl, onUnauthorized: () => (signedOut += 1) });
    await expect(api.listTasks()).rejects.toThrow("HTTP 401");
    expect(signedOut).toBe(1);
  });

  test("creates an API key with a name and a permission", async () => {
    const posted: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return jsonResponse(
        { id: "k1", name: "ci", key: "ms_live_secret", start: "ms_liv", permission: "write", createdAt: "2026-11-24T00:00:00.000Z" },
        201,
      );
    }) as typeof fetch;
    const created = await createApiClient({ baseUrl: BASE, fetchImpl }).createApiKey("ci", "write");
    expect(posted).toEqual([{ url: `${BASE}/v1/api-keys`, body: { name: "ci", permission: "write" } }]);
    expect(created.key).toBe("ms_live_secret");
  });
});

describe("API keys", () => {
  test("a listed key shows its prefix and its permission", () => {
    expect(
      toKeyRow({
        id: "k1",
        name: "ci",
        start: "ms_liv",
        prefix: "ms_live_",
        permissions: { modelstill: ["read", "write"] },
        createdAt: "2026-11-24T00:00:00.000Z",
        lastRequest: null,
      }),
    ).toEqual({
      id: "k1",
      name: "ci",
      start: "ms_liv",
      permission: "write",
      createdAt: "2026-11-24T00:00:00.000Z",
      lastRequest: null,
    });
    expect(toKeyRow({ id: "k2", name: null, start: null, permissions: null, createdAt: new Date("2026-11-24T00:00:00.000Z") }).permission).toBe("read");
  });

  test("lists and revokes through the auth client and creates through the API", async () => {
    const deleted: string[] = [];
    const authClient = {
      apiKey: {
        list: async () => ({
          data: { apiKeys: [{ id: "k1", name: "ci", start: "ms_liv", permissions: { modelstill: ["read"] }, createdAt: "2026-11-24T00:00:00.000Z" }] },
          error: null,
        }),
        delete: async ({ keyId }: { keyId: string }) => {
          deleted.push(keyId);
          return { data: { success: true }, error: null };
        },
      },
    };
    const api = { createApiKey: async () => ({ id: "k9", name: "x", key: "ms_live_x", start: "ms_liv", permission: "read" as const, createdAt: "" }) };
    const keys = createKeysApi(api, authClient);
    expect((await keys.list()).map((row) => row.id)).toEqual(["k1"]);
    await keys.revoke("k1");
    expect(deleted).toEqual(["k1"]);
    expect((await keys.create("x", "read")).key).toBe("ms_live_x");
  });

  test("a failed revoke is an error", async () => {
    const authClient = {
      apiKey: {
        list: async () => ({ data: null, error: { message: "nope" } }),
        delete: async () => ({ data: null, error: { message: "Key not found" } }),
      },
    };
    const keys = createKeysApi({ createApiKey: async () => { throw new Error("unused"); } }, authClient);
    await expect(keys.revoke("k1")).rejects.toThrow("Key not found");
    await expect(keys.list()).rejects.toThrow("nope");
  });

  test("the curl sample reads the key from the environment", () => {
    expect(curlSample("http://localhost:8787")).toBe(
      'curl http://localhost:8787/v1/tasks \\\n  -H "Authorization: Bearer $MODELSTILL_API_KEY"',
    );
  });

  test("the create call posts the name and permission with the session cookie", () => {
    expect(createKeyCurl("http://localhost:8787", "ci", "write")).toBe(
      [
        "curl -X POST http://localhost:8787/v1/api-keys \\",
        "  -b cookies.txt \\",
        '  -H "content-type: application/json" \\',
        `  -d '{"name":"ci","permission":"write"}'`,
      ].join("\n"),
    );
  });

  test("masks a key after its prefix", () => {
    expect(maskedKey("ms_liv")).toBe("ms_liv••••••••••••");
    expect(maskedKey(null)).toBe("ms_live_••••••••••••");
  });
});

describe("connecting over MCP", () => {
  test("the MCP URL comes from NEXT_PUBLIC_MCP_URL or the local default", () => {
    expect(DEFAULT_MCP_URL).toBe("http://localhost:3104/mcp");
    expect(mcpUrl({})).toBe("http://localhost:3104/mcp");
    expect(mcpUrl({ NEXT_PUBLIC_MCP_URL: "https://mcp.example/mcp" })).toBe("https://mcp.example/mcp");
  });

  test("gives the Claude Code command and both config files", () => {
    const url = "http://localhost:3104/mcp";
    expect(claudeCommand(url)).toBe("claude mcp add --transport http modelstill http://localhost:3104/mcp");
    expect(JSON.parse(mcpJsonConfig(url))).toEqual({
      mcpServers: {
        modelstill: {
          type: "http",
          url,
          headers: { Authorization: "Bearer ${MODELSTILL_API_KEY}" },
        },
      },
    });
    expect(JSON.parse(cursorConfig(url))).toEqual({
      mcpServers: { modelstill: { url, headers: { Authorization: "Bearer ${env:MODELSTILL_API_KEY}" } } },
    });
  });
});

describe("navigation for account pages", () => {
  test("settings and connect have their own crumbs and icons", () => {
    expect(sectionForPath("/settings/api-keys")).toBe("settings");
    expect(sectionForPath("/settings/mcp")).toBe("settings");
    expect(breadcrumbs("/settings/api-keys")).toEqual([{ label: "Settings" }, { label: "API keys" }]);
    expect(breadcrumbs("/settings/mcp")).toEqual([{ label: "Settings" }, { label: "Connect via MCP" }]);
  });
});
