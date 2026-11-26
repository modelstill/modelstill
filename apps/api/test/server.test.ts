import { describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";

describe("server", () => {
  test("listens on 8787 by default and on PORT when set", () => {
    expect(createServer({}).port).toBe(8787);
    expect(createServer({ PORT: "9001" }).port).toBe(9001);
  });

  test("uses the Postgres store only when DATABASE_URL is set", () => {
    expect(createServer({}).storeKind).toBe("memory");
    expect(createServer({ DATABASE_URL: "postgres://user:pass@localhost:1/none" }).storeKind).toBe("postgres");
  });

  test("uses ClickHouse traffic only when CLICKHOUSE_URL is set", () => {
    expect(createServer({}).trafficKind).toBe("none");
    expect(createServer({ CLICKHOUSE_URL: "http://localhost:1" }).trafficKind).toBe("clickhouse");
  });

  test("keeps case datasets with the store and reads requests from the configured ClickHouse database", async () => {
    expect(createServer({}).datasetsKind).toBe("memory");
    expect(createServer({ DATABASE_URL: "postgres://user:pass@localhost:1/none" }).datasetsKind).toBe("postgres");
    expect(createServer({ CLICKHOUSE_URL: "http://localhost:1", CLICKHOUSE_DATABASE: "staging_ms" }).clickhouseDatabase).toBe("staging_ms");
    expect(createServer({ CLICKHOUSE_URL: "http://localhost:1" }).clickhouseDatabase).toBe("modelstill");
    const server = createServer({ MODELSTILL_API_TOKEN: "secret" });
    const response = await server.fetch(new Request("http://localhost/v1/requests", { headers: { authorization: "Bearer secret" } }));
    expect(await response.json()).toEqual({ requests: [], nextCursor: null, requestBodyStored: false });
  });

  test("keeps auth in memory without DATABASE_URL and in Postgres with it", () => {
    expect(createServer({}).authKind).toBe("memory");
    expect(createServer({ DATABASE_URL: "postgres://user:pass@localhost:1/none" }).authKind).toBe("postgres");
  });

  test("keeps MODELSTILL_API_TOKEN as an admin credential and refuses anonymous reads and writes", async () => {
    const put = (server: ReturnType<typeof createServer>, token: string) =>
      server.fetch(
        new Request("http://localhost/v1/tasks/t", {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ version: 1, snapshotHash: "h", gitSha: "g", spec: {} }),
        }),
      );
    expect((await put(createServer({}), "secret")).status).toBe(401);
    const server = createServer({ MODELSTILL_API_TOKEN: "secret" });
    expect((await put(server, "secret")).status).toBe(200);
    expect((await server.fetch(new Request("http://localhost/v1/tasks"))).status).toBe(401);
    const read = await server.fetch(new Request("http://localhost/v1/tasks", { headers: { authorization: "Bearer secret" } }));
    expect(read.status).toBe(200);
  });

  test("names this API in the 401 challenge from BETTER_AUTH_URL", async () => {
    const server = createServer({ BETTER_AUTH_URL: "https://api.modelstill.test" });
    const response = await server.fetch(new Request("http://localhost/v1/tasks"));
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://api.modelstill.test/.well-known/oauth-protected-resource"',
    );
  });

  test("points MCP sign-in at the dashboard named by FRONTEND_URL", async () => {
    const server = createServer({ FRONTEND_URL: "https://app.modelstill.test" });
    const query = new URLSearchParams({ client_id: "c", response_type: "code", redirect_uri: "http://x/cb", prompt: "consent" });
    const response = await server.fetch(new Request(`http://localhost/api/auth/mcp/authorize?${query}`));
    expect(response.headers.get("location")).toStartWith("https://app.modelstill.test/login?");
  });

  test("serves the API with credentialed CORS for the local dashboard", async () => {
    const server = createServer({ MODELSTILL_API_TOKEN: "secret" });
    const response = await server.fetch(
      new Request("http://localhost/v1/tasks", { headers: { origin: "http://localhost:4323", authorization: "Bearer secret" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tasks: [] });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:4323");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
