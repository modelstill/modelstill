import { beforeEach, describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { authUser } from "../src/db/auth-schema.ts";
import { authFixture } from "./auth-fixture.ts";

let fx: ReturnType<typeof authFixture>;

beforeEach(() => {
  fx = authFixture();
});

type SessionBody = { user: { email: string; onboardedAt?: string | null } };

async function session(cookie: string): Promise<SessionBody> {
  const response = await fx.call("/api/auth/get-session", { headers: { cookie } });
  return (await response.json()) as SessionBody;
}

async function finish(cookie: string): Promise<Response> {
  return fx.call("/v1/me/onboarding", fx.json("POST", {}, { cookie }));
}

describe("onboarding", () => {
  test("a new user starts not onboarded", async () => {
    const cookie = await fx.signIn("new@example.com");
    expect((await session(cookie)).user.onboardedAt ?? null).toBeNull();
  });

  test("finishing onboarding is stored on the user and survives a new sign-in", async () => {
    const cookie = await fx.signIn("new@example.com");
    const finished = await finish(cookie);
    expect(finished.status).toBe(200);
    const body = (await finished.json()) as { onboardedAt: string };
    expect(Number.isNaN(Date.parse(body.onboardedAt))).toBe(false);

    const again = await fx.signIn("new@example.com");
    expect(new Date((await session(again)).user.onboardedAt ?? 0).toISOString()).toBe(body.onboardedAt);
  });

  test("finishing twice keeps the first time", async () => {
    const cookie = await fx.signIn("new@example.com");
    const first = (await (await finish(cookie)).json()) as { onboardedAt: string };
    const second = (await (await finish(cookie)).json()) as { onboardedAt: string };
    expect(second.onboardedAt).toBe(first.onboardedAt);
  });

  test("only a signed-in user can finish onboarding", async () => {
    const response = await fx.call("/v1/me/onboarding", fx.json("POST", {}));
    expect(response.status).toBe(401);
  });

  test("a user cannot set the field through update-user", async () => {
    const cookie = await fx.signIn("new@example.com");
    await fx.call("/api/auth/update-user", fx.json("POST", { onboardedAt: "2020-01-01T00:00:00.000Z" }, { cookie }));
    expect((await session(cookie)).user.onboardedAt ?? null).toBeNull();
  });

  test("the auth_user table has an onboarded_at column", () => {
    expect(Object.values(getTableColumns(authUser)).map((column) => column.name)).toContain("onboarded_at");
  });
});
