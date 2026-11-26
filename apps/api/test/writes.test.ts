import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { createMemoryStore, type MemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";
const RUN_ID = "43f6386472184191b3c94358de47ede8";
const RUN_UUID = "43f63864-7218-4191-b3c9-4358de47ede8";
const OTHER_RUN_ID = "393ea049-f455-40dd-b5cf-e185d6e8b169";
const GATE_ID = "0b6a3c55-61d4-4f0b-9d2e-6a1f0c7e2a11";

const hashes = Array.from({ length: 50 }, (_, index) => `case-${String(index).padStart(3, "0")}`);

const taskBody = { version: 1, snapshotHash: "d9c454a2", gitSha: "6256a10", spec: { task: "technographics-real" } };

function runBody(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    createdAt: "2026-11-23T13:27:48.259Z",
    model: "technographics",
    split: "gold",
    judgeModel: null,
    benchmark: { name: "tech_gold", version: "d9c454a2d532" },
    metrics: { pooled_f1: { value: 0.819, low: 0.78, high: 0.855 } },
    primaryMetric: "pooled_f1",
    cases: hashes.map((inputHash, index) => ({ inputHash, score: index % 4 === 0 ? 0 : 1, output: [`tech-${index}`] })),
    ...overrides,
  };
}

let store: MemoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = createMemoryStore();
  app = createApp({ store, apiToken: TOKEN });
});

async function send(method: string, path: string, body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  const response = await app.request(path, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function get(path: string, token: string | null = TOKEN) {
  const response = await app.request(path, token === null ? {} : { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

async function withTaskAndRun() {
  await send("PUT", "/v1/tasks/technographics-real", taskBody);
  await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody());
}

describe("write authentication", () => {
  const writes: [string, string, unknown][] = [
    ["PUT", "/v1/tasks/technographics-real", taskBody],
    ["POST", "/v1/tasks/technographics-real/eval-runs", runBody()],
    ["POST", "/v1/tasks/technographics-real/gates", { id: GATE_ID, evalRunId: RUN_ID, passed: true, checks: [], report: {} }],
    ["POST", "/v1/tasks/technographics-real/review-items", { items: [] }],
    ["PUT", "/v1/tasks/technographics-real/deployment", { mode: "off", targetError: 0.05 }],
  ];

  test("every write needs the bearer token", async () => {
    for (const [method, path, body] of writes) {
      expect((await send(method, path, body, null)).status).toBe(401);
      expect((await send(method, path, body, "wrong")).status).toBe(401);
    }
  });

  test("writes are refused when the server has no token configured", async () => {
    app = createApp({ store });
    expect((await send("PUT", "/v1/tasks/technographics-real", taskBody, "")).status).toBe(401);
    expect((await send("PUT", "/v1/tasks/technographics-real", taskBody, "anything")).status).toBe(401);
  });

  test("reads need a credential too", async () => {
    expect((await get("/v1/tasks")).status).toBe(200);
    expect((await get("/v1/tasks", null)).status).toBe(401);
    expect((await get("/v1/tasks", "wrong")).status).toBe(401);
    expect((await get("/health", null)).status).toBe(200);
  });

  test("the OpenAPI document lists the write paths with every accepted credential", async () => {
    const { body } = await get("/openapi.json");
    expect(body.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(body.paths["/v1/tasks/{slug}"].put.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(body.paths["/v1/tasks/{slug}/eval-runs"].post.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(body.paths["/v1/tasks/{slug}/gates"].post.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(body.paths["/v1/tasks/{slug}/review-items"].post.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(body.paths["/v1/tasks/{slug}/deployment"].put.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(Object.keys(body.components.schemas)).toEqual(
      expect.arrayContaining(["TaskUpsert", "EvalRunCreate", "GateCreate", "ReviewItemsUpsert", "DeploymentUpdate", "Metric"]),
    );
  });
});

describe("PUT /v1/tasks/{slug}", () => {
  test("creates the task and registers the version", async () => {
    const { status, body } = await send("PUT", "/v1/tasks/technographics-real", taskBody);
    expect(status).toBe(200);
    expect(body.task).toMatchObject({ slug: "technographics-real", version: 1, snapshotHash: "d9c454a2", mode: "off" });
    expect(body.version).toMatchObject({ version: 1, snapshotHash: "d9c454a2", gitSha: "6256a10" });
    expect((await get("/v1/tasks")).body.tasks.map((task: { slug: string }) => task.slug)).toEqual(["technographics-real"]);
    expect((await get("/v1/tasks/technographics-real/versions")).body.versions).toHaveLength(1);
  });

  test("the same snapshot twice keeps one version; a new snapshot becomes current", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    const { body } = await send("PUT", "/v1/tasks/technographics-real", { ...taskBody, version: 2, snapshotHash: "eeee" });
    expect(body.task.version).toBe(2);
    const versions = (await get("/v1/tasks/technographics-real/versions")).body.versions;
    expect(versions.map((version: { version: number }) => version.version)).toEqual([2, 1]);
  });

  test("rejects an invalid body", async () => {
    expect((await send("PUT", "/v1/tasks/technographics-real", { version: 0 })).status).toBe(400);
  });
});

describe("POST /v1/tasks/{slug}/eval-runs", () => {
  test("needs a registered task", async () => {
    expect((await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody())).status).toBe(404);
  });

  test("creates a run whose score is the primary metric", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    const { status, body } = await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody());
    expect(status).toBe(201);
    expect(body.run).toMatchObject({
      id: RUN_UUID,
      model: "technographics",
      split: "gold",
      judgeModel: "",
      mean: 0.819,
      low: 0.78,
      high: 0.855,
      cases: 50,
      primaryMetric: "pooled_f1",
      metrics: { pooled_f1: { value: 0.819, low: 0.78, high: 0.855 } },
      benchmark: { name: "tech_gold", version: "d9c454a2d532" },
    });
    const listed = (await get("/v1/tasks/technographics-real/eval-runs")).body.runs;
    expect(listed).toEqual([body.run]);
  });

  test("is idempotent on the run id", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody());
    const again = await send("POST", "/v1/tasks/technographics-real/eval-runs", { ...runBody(), id: RUN_UUID });
    expect(again.status).toBe(200);
    expect((await get("/v1/tasks/technographics-real/eval-runs")).body.runs).toHaveLength(1);
  });

  test("falls back to the per-case mean without a primary metric", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    const { body } = await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody({ primaryMetric: undefined, metrics: {} }));
    expect(body.run.primaryMetric).toBeNull();
    expect(body.run.mean).toBeCloseTo(0.74);
    expect(body.run.low).toBeLessThan(0.74);
    expect(body.run.high).toBeGreaterThan(0.74);
  });

  test("a primary metric must be one of the run's metrics", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    expect((await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody({ primaryMetric: "nope" }))).status).toBe(400);
  });

  test("run ids are uuids, with or without dashes", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    expect((await send("POST", "/v1/tasks/technographics-real/eval-runs", runBody({ id: "run-1" }))).status).toBe(400);
  });

  test("compare pairs the pushed runs on their per-case scores", async () => {
    await withTaskAndRun();
    const better = runBody({ id: OTHER_RUN_ID, cases: hashes.map((inputHash) => ({ inputHash, score: 1, output: [] })) });
    await send("POST", "/v1/tasks/technographics-real/eval-runs", better);
    const { status, body } = await get(`/v1/eval-runs/compare?before=${RUN_ID}&after=${OTHER_RUN_ID}`);
    expect(status).toBe(200);
    expect(body.before.id).toBe(RUN_UUID);
    expect(body.difference).toBeCloseTo(0.26);
    expect(body.fixed).toBe(13);
    expect(body.broken).toBe(0);
    expect(body.cases).toHaveLength(50);
  });
});

describe("POST /v1/tasks/{slug}/gates", () => {
  const gateBody = {
    id: GATE_ID,
    evalRunId: RUN_ID,
    passed: false,
    checks: [{ name: "metric_lower_bound", threshold: 0.81, value: 0.78, passed: false }],
    report: { passed: false, primaryMetric: "pooled_f1" },
  };

  test("records a gate against a pushed run", async () => {
    await withTaskAndRun();
    const { status, body } = await send("POST", "/v1/tasks/technographics-real/gates", gateBody);
    expect(status).toBe(201);
    expect(body.gate).toMatchObject({ id: GATE_ID, taskSlug: "technographics-real", passed: false, checks: gateBody.checks });
    expect((await get("/v1/tasks/technographics-real/gates")).body.gates).toEqual([body.gate]);
    expect((await get("/v1/tasks/technographics-real")).body.task.lastGatePassed).toBe(false);
  });

  test("is idempotent on the gate id", async () => {
    await withTaskAndRun();
    await send("POST", "/v1/tasks/technographics-real/gates", gateBody);
    expect((await send("POST", "/v1/tasks/technographics-real/gates", gateBody)).status).toBe(200);
    expect((await get("/v1/tasks/technographics-real/gates")).body.gates).toHaveLength(1);
  });

  test("an unknown eval run or previous run is a 404", async () => {
    await withTaskAndRun();
    expect((await send("POST", "/v1/tasks/technographics-real/gates", { ...gateBody, evalRunId: OTHER_RUN_ID })).status).toBe(404);
    expect((await send("POST", "/v1/tasks/technographics-real/gates", { ...gateBody, previousEvalRunId: OTHER_RUN_ID })).status).toBe(404);
  });
});

describe("POST /v1/tasks/{slug}/review-items", () => {
  const items = [
    { inputHash: "q1", input: { posting: "Snowflake and dbt" }, teacherOutputs: { a: ["snowflake", "dbt"], b: ["snowflake"] }, agreement: false, reviewState: "queued" },
    { inputHash: "q2", input: { posting: "Kafka" }, teacherOutputs: { a: ["kafka"], b: ["kafka"] }, agreement: true, reviewState: "none" },
  ];

  test("upserts items and queues the disagreements", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    const { status, body } = await send("POST", "/v1/tasks/technographics-real/review-items", { items });
    expect(status).toBe(200);
    expect(body).toEqual({ upserted: 2 });
    const queue = (await get("/v1/tasks/technographics-real/review-queue")).body.items;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ inputHash: "q1", agreement: false, reviewState: "queued" });
  });

  test("pushing again updates in place and keeps a human decision", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    await send("POST", "/v1/tasks/technographics-real/review-items", { items });
    const [queued] = (await get("/v1/tasks/technographics-real/review-queue")).body.items;
    await app.request(`/v1/review-queue/${queued.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ verdict: "accept", reviewer: "ada" }),
    });
    await send("POST", "/v1/tasks/technographics-real/review-items", { items });
    expect((await get("/v1/tasks/technographics-real/review-queue")).body.items).toEqual([]);
  });

  test("needs a registered task", async () => {
    expect((await send("POST", "/v1/tasks/technographics-real/review-items", { items })).status).toBe(404);
  });
});

describe("PUT /v1/tasks/{slug}/deployment", () => {
  test("sets the deployment the read side returns", async () => {
    await send("PUT", "/v1/tasks/technographics-real", taskBody);
    const update = { mode: "shadow", studentModel: "technographics-v1", threshold: 0.8, targetError: 0.05, shadowSample: 0.2 };
    const { status, body } = await send("PUT", "/v1/tasks/technographics-real/deployment", update);
    expect(status).toBe(200);
    expect(body.deployment).toMatchObject(update);
    expect((await get("/v1/tasks/technographics-real/deployment")).body.deployment).toEqual(body.deployment);
    expect((await get("/v1/tasks/technographics-real")).body.task.mode).toBe("shadow");
  });

  test("needs a registered task", async () => {
    expect((await send("PUT", "/v1/tasks/nope/deployment", { mode: "off", targetError: 0.05 })).status).toBe(404);
  });
});
