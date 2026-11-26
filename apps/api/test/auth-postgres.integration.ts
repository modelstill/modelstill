import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, gte, inArray } from "drizzle-orm";
import { connect } from "../src/db/client.ts";
import { authApikey, authJwks, authOauthApplication, authSchema, authUser } from "../src/db/schema.ts";
import { authFixture, taskBody } from "./auth-fixture.ts";

const url = process.env["DATABASE_URL"];

describe.skipIf(!url)("auth on Postgres", () => {
  const email = `it-${crypto.randomUUID().slice(0, 8)}@example.com`;
  let connection: ReturnType<typeof connect>;
  let fx: ReturnType<typeof authFixture>;
  const startedAt = new Date();

  beforeAll(() => {
    connection = connect(url!, 2);
    fx = authFixture({ database: drizzleAdapter(connection.db, { provider: "pg", schema: authSchema }) });
  });

  afterAll(async () => {
    const users = await connection.db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email));
    const ids = users.map((user) => user.id);
    if (ids.length) {
      await connection.db.delete(authApikey).where(inArray(authApikey.referenceId, ids));
      await connection.db.delete(authUser).where(inArray(authUser.id, ids));
    }
    await connection.db.delete(authOauthApplication).where(eq(authOauthApplication.name, "Test MCP client"));
    await connection.db.delete(authJwks).where(gte(authJwks.createdAt, startedAt));
    await connection.client.end();
  });

  test("a code signs in, a key reads and writes, and an MCP token verifies", async () => {
    const cookie = await fx.signIn(email);
    expect((await fx.call("/v1/tasks", { headers: { cookie } })).status).toBe(200);

    const created = await fx.createKey(cookie, "read");
    expect(created.status).toBe(201);
    const key = String(created.body["key"]);
    expect(key).toStartWith("ms_live_");
    const [stored] = await connection.db.select().from(authApikey).where(eq(authApikey.id, String(created.body["id"])));
    expect(stored?.key).not.toBe(key);
    expect(JSON.parse(stored!.permissions!)).toEqual({ modelstill: ["read"] });
    expect((await fx.call("/v1/tasks", { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
    expect((await fx.call("/v1/tasks/t", fx.json("PUT", taskBody, { "x-api-key": key }))).status).toBe(403);

    const token = await fx.oauthToken(cookie, "openid modelstill:read");
    const session = await fx.call("/api/auth/mcp/get-session", { headers: { authorization: `Bearer ${token}` } });
    expect(((await session.json()) as { scopes: string }).scopes).toBe("openid modelstill:read");
  });
});
