import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { createMemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";
const KEY = "technographics-9256c08a-a41fcbab-s1";
const RUN_PATH = `/v1/tasks/technographics/train-runs/${KEY}`;
const METRICS_PATH = `/v1/train-runs/${KEY}/metrics`;

const runBody = {
  base: "Qwen/Qwen3-4B",
  method: "lora",
  status: "running",
  manifest: { snapshot: "9256c08a", plan: { method: "lora" } },
  startedAt: "2026-11-24T08:00:00.000Z",
};

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ store: createMemoryStore(), apiToken: TOKEN });
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

describe("train run writes", () => {
  test("need the bearer token", async () => {
    expect((await send("PUT", RUN_PATH, runBody, null)).status).toBe(401);
    expect((await send("POST", METRICS_PATH, { metrics: [] }, "wrong")).status).toBe(401);
  });

  test("are listed in the OpenAPI document with every accepted credential", async () => {
    const { body } = await get("/openapi.json");
    expect(body.paths["/v1/tasks/{slug}/train-runs/{key}"].put.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(body.paths["/v1/train-runs/{key}/metrics"].post.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }]);
    expect(body.paths["/v1/tasks/{slug}/train-runs"].get).toBeDefined();
    expect(body.paths["/v1/train-runs/{key}"].get).toBeDefined();
  });
});

describe("PUT /v1/tasks/{slug}/train-runs/{key}", () => {
  test("creates a running run", async () => {
    const { status, body } = await send("PUT", RUN_PATH, runBody);
    expect(status).toBe(200);
    expect(body.run).toEqual({
      key: KEY,
      taskSlug: "technographics",
      base: "Qwen/Qwen3-4B",
      method: "lora",
      status: "running",
      manifest: runBody.manifest,
      attestation: null,
      finalMetrics: null,
      startedAt: "2026-11-24T08:00:00.000Z",
      finishedAt: null,
    });
  });

  test("finishing keeps the start time and fields the update leaves out", async () => {
    await send("PUT", RUN_PATH, runBody);
    const { body } = await send("PUT", RUN_PATH, {
      base: "Qwen/Qwen3-4B",
      method: "lora",
      status: "succeeded",
      finalMetrics: { eval_loss: 0.42, train_loss: 0.51 },
      attestation: { train: { rows: 10 } },
    });
    expect(body.run).toMatchObject({
      status: "succeeded",
      manifest: runBody.manifest,
      attestation: { train: { rows: 10 } },
      finalMetrics: { eval_loss: 0.42, train_loss: 0.51 },
      startedAt: "2026-11-24T08:00:00.000Z",
    });
    expect(typeof body.run.finishedAt).toBe("string");
  });

  test("a finished time that is given is kept", async () => {
    const { body } = await send("PUT", RUN_PATH, { ...runBody, status: "failed", finishedAt: "2026-11-24T09:00:00.000Z" });
    expect(body.run.finishedAt).toBe("2026-11-24T09:00:00.000Z");
  });

  test("times with an offset are stored in UTC like every other timestamp", async () => {
    const { body } = await send("PUT", RUN_PATH, { ...runBody, startedAt: "2026-11-24T10:00:00+02:00" });
    expect(body.run.startedAt).toBe("2026-11-24T08:00:00.000Z");
  });

  test("a key that belongs to another task is a conflict", async () => {
    await send("PUT", RUN_PATH, runBody);
    expect((await send("PUT", `/v1/tasks/other/train-runs/${KEY}`, runBody)).status).toBe(409);
  });

  test("rejects an unknown status and an unsafe key", async () => {
    expect((await send("PUT", RUN_PATH, { ...runBody, status: "queued" })).status).toBe(400);
    expect((await send("PUT", "/v1/tasks/technographics/train-runs/a%20b", runBody)).status).toBe(400);
  });
});

describe("POST /v1/train-runs/{key}/metrics", () => {
  test("needs a known run", async () => {
    expect((await send("POST", METRICS_PATH, { metrics: [{ step: 1, name: "loss", value: 1 }] })).status).toBe(404);
  });

  test("stores points idempotently and the run returns them grouped by name", async () => {
    await send("PUT", RUN_PATH, runBody);
    const batch = {
      metrics: [
        { step: 20, epoch: 0.2, name: "loss", value: 1.1 },
        { step: 10, epoch: 0.1, name: "loss", value: 1.4 },
        { step: 10, name: "learning_rate", value: 0.0002 },
        { step: 20, epoch: 0.2, name: "eval_loss", value: 0.9 },
      ],
    };
    const first = await send("POST", METRICS_PATH, batch);
    expect(first).toEqual({ status: 200, body: { accepted: 4 } });
    await send("POST", METRICS_PATH, batch);
    await send("POST", METRICS_PATH, { metrics: [{ step: 20, epoch: 0.2, name: "loss", value: 1.0 }] });

    const { status, body } = await get(`/v1/train-runs/${KEY}`);
    expect(status).toBe(200);
    expect(body.run.key).toBe(KEY);
    expect(body.series).toEqual({
      eval_loss: [{ step: 20, epoch: 0.2, value: 0.9 }],
      learning_rate: [{ step: 10, epoch: null, value: 0.0002 }],
      loss: [
        { step: 10, epoch: 0.1, value: 1.4 },
        { step: 20, epoch: 0.2, value: 1.0 },
      ],
    });
  });

  test("rejects a negative step and an empty name", async () => {
    await send("PUT", RUN_PATH, runBody);
    expect((await send("POST", METRICS_PATH, { metrics: [{ step: -1, name: "loss", value: 1 }] })).status).toBe(400);
    expect((await send("POST", METRICS_PATH, { metrics: [{ step: 1, name: "", value: 1 }] })).status).toBe(400);
  });
});

describe("train run reads", () => {
  test("list a task's runs newest first", async () => {
    await send("PUT", RUN_PATH, runBody);
    await send("PUT", "/v1/tasks/technographics/train-runs/technographics-9256c08a-a41fcbab-s2", {
      ...runBody,
      startedAt: "2026-11-24T10:00:00.000Z",
    });
    await send("PUT", "/v1/tasks/other/train-runs/other-1", runBody);
    const { status, body } = await get("/v1/tasks/technographics/train-runs");
    expect(status).toBe(200);
    expect(body.runs.map((run: { key: string }) => run.key)).toEqual([
      "technographics-9256c08a-a41fcbab-s2",
      KEY,
    ]);
  });

  test("an unknown run is not found", async () => {
    expect((await get("/v1/train-runs/nope")).status).toBe(404);
  });
});
