import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { createMemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";
const SLUG = "qa";
const ALERT_ID = "0b6a3c55-61d4-4f0b-9d2e-6a1f0c7e2a11";
const CANARY_ID = "43f63864-7218-4191-b3c9-4358de47ede8";

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  app = createApp({ store: createMemoryStore(), apiToken: TOKEN });
  await send("PUT", `/v1/tasks/${SLUG}`, { version: 1, snapshotHash: "abc", gitSha: "def", spec: { task: SLUG } });
});

async function send(method: string, path: string, body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  const response = await app.request(path, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function get(path: string) {
  const response = await app.request(path, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: response.status, body: await response.json() };
}

const canary = {
  id: CANARY_ID,
  createdAt: "2026-11-25T10:00:00.000Z",
  provider: "openai/gpt-x",
  passed: 18,
  total: 20,
  low: 0.683,
  high: 0.988,
};

const alert = {
  id: ALERT_ID,
  kind: "canary_below_floor",
  severity: "critical",
  createdAt: "2026-11-25T10:00:01.000Z",
  payload: { message: "pass rate below the floor", details: { floor: 0.95 } },
};

describe("POST /v1/tasks/{slug}/canaries", () => {
  test("records canary runs the monitoring page reads back", async () => {
    const later = { ...canary, id: undefined, createdAt: "2026-11-25T11:00:00.000Z", passed: 20 };
    const { status, body } = await send("POST", `/v1/tasks/${SLUG}/canaries`, { runs: [canary, later] });

    expect(status).toBe(200);
    expect(body.recorded).toBe(2);
    const { id: _id, ...stored } = canary;
    const runs = (await get(`/v1/tasks/${SLUG}/canaries`)).body.runs;
    expect(runs).toEqual([{ ...stored, createdAt: later.createdAt, passed: 20 }, stored]);
  });

  test("sending a run again with its id records it once", async () => {
    await send("POST", `/v1/tasks/${SLUG}/canaries`, { runs: [canary] });
    const again = await send("POST", `/v1/tasks/${SLUG}/canaries`, { runs: [canary] });

    expect(again.body.recorded).toBe(0);
    expect((await get(`/v1/tasks/${SLUG}/canaries`)).body.runs).toHaveLength(1);
  });

  test("stores times in one ISO form whatever offset they were sent with", async () => {
    await send("POST", `/v1/tasks/${SLUG}/canaries`, { runs: [{ ...canary, createdAt: "2026-11-25T12:00:00.5+02:00" }] });
    await send("POST", `/v1/tasks/${SLUG}/alerts`, { alerts: [{ ...alert, createdAt: "2026-11-25T10:00:01.123456+00:00" }] });

    expect((await get(`/v1/tasks/${SLUG}/canaries`)).body.runs[0].createdAt).toBe("2026-11-25T10:00:00.500Z");
    expect((await get(`/v1/tasks/${SLUG}/alerts`)).body.alerts[0].createdAt).toBe("2026-11-25T10:00:01.123Z");
  });

  test("refuses a run that passed more items than it ran", async () => {
    expect((await send("POST", `/v1/tasks/${SLUG}/canaries`, { runs: [{ ...canary, passed: 21 }] })).status).toBe(400);
  });

  test("an unknown task is 404 and an anonymous write is 401", async () => {
    expect((await send("POST", "/v1/tasks/nope/canaries", { runs: [canary] })).status).toBe(404);
    expect((await send("POST", `/v1/tasks/${SLUG}/canaries`, { runs: [canary] }, null)).status).toBe(401);
  });
});

describe("POST /v1/tasks/{slug}/alerts", () => {
  test("records alerts the monitoring page reads back, unacknowledged", async () => {
    const { status, body } = await send("POST", `/v1/tasks/${SLUG}/alerts`, { alerts: [alert] });

    expect(status).toBe(200);
    expect(body.recorded).toBe(1);
    expect((await get(`/v1/tasks/${SLUG}/alerts`)).body.alerts).toEqual([{ ...alert, ackedAt: null }]);
  });

  test("an alert without an id gets one, and a repeated id is recorded once", async () => {
    const { id: _id, ...anonymous } = alert;
    await send("POST", `/v1/tasks/${SLUG}/alerts`, { alerts: [alert, anonymous] });
    const again = await send("POST", `/v1/tasks/${SLUG}/alerts`, { alerts: [alert] });

    expect(again.body.recorded).toBe(0);
    const stored = (await get(`/v1/tasks/${SLUG}/alerts`)).body.alerts;
    expect(stored).toHaveLength(2);
    expect(stored.every((entry: { id: string }) => entry.id.length > 0)).toBe(true);
  });

  test("refuses an alert without a kind and an unknown task", async () => {
    expect((await send("POST", `/v1/tasks/${SLUG}/alerts`, { alerts: [{ ...alert, kind: "" }] })).status).toBe(400);
    expect((await send("POST", "/v1/tasks/nope/alerts", { alerts: [alert] })).status).toBe(404);
  });

  test("both writes are in the OpenAPI document", async () => {
    const paths = (await get("/openapi.json")).body.paths;
    expect(paths["/v1/tasks/{slug}/canaries"].post).toBeDefined();
    expect(paths["/v1/tasks/{slug}/alerts"].post).toBeDefined();
  });
});
