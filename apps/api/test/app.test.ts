import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { createMemoryStore, type MemoryData, type MemoryStore } from "../src/store-memory.ts";
import type { GateRecord, TaskSummary } from "../src/store.ts";
import type { TrafficBucket, TrafficStore } from "../src/traffic.ts";

const technographics: TaskSummary = {
  slug: "technographics",
  version: 2,
  snapshotHash: "9e7da67f",
  mode: "shadow",
  deferralShare: null,
  lastGatePassed: true,
};

const gate: GateRecord = {
  id: "g1",
  taskSlug: "technographics",
  createdAt: "2026-11-23T00:00:00.000Z",
  passed: false,
  checks: [{ name: "metric_lower_bound", threshold: 0.81, value: 0.74, passed: false }],
};

const hashes = Array.from({ length: 120 }, (_, index) => `case-${String(index).padStart(3, "0")}`);

function fixture(): MemoryData {
  return {
    tasks: [technographics],
    gates: [gate],
    versions: [
      { taskSlug: "technographics", id: "v1", version: 1, snapshotHash: "aaa", gitSha: "111", createdAt: "2026-11-01T00:00:00.000Z" },
      { taskSlug: "technographics", id: "v2", version: 2, snapshotHash: "bbb", gitSha: "222", createdAt: "2026-11-10T00:00:00.000Z" },
    ],
    evalRuns: [
      {
        taskSlug: "technographics",
        id: "run-old",
        createdAt: "2026-11-02T00:00:00.000Z",
        model: "gpt-cloud",
        split: "gold",
        judgeModel: "judge-x",
        scores: hashes.map((inputHash, index) => ({ inputHash, score: index % 2 })),
      },
      {
        taskSlug: "technographics",
        id: "run-new",
        createdAt: "2026-11-12T00:00:00.000Z",
        model: "technographics-v2",
        split: "gold",
        judgeModel: "judge-x",
        scores: hashes.map((inputHash, index) => ({ inputHash, score: index % 5 === 0 ? 0 : 1 })),
      },
      {
        taskSlug: "technographics",
        id: "run-partial",
        createdAt: "2026-11-05T00:00:00.000Z",
        model: "technographics-v1",
        split: "val",
        judgeModel: "judge-x",
        scores: hashes.slice(0, 10).map((inputHash) => ({ inputHash, score: 1 })),
      },
    ],
    reviewItems: [
      {
        taskSlug: "technographics",
        id: "item-1",
        inputHash: "q1",
        input: { text: "We run Snowflake and dbt" },
        teacherOutputs: { a: ["snowflake", "dbt"], b: ["snowflake"] },
        agreement: false,
        reviewState: "queued",
      },
      {
        taskSlug: "technographics",
        id: "item-2",
        inputHash: "q2",
        input: { text: "Kafka" },
        teacherOutputs: { a: ["kafka"], b: ["kafka"] },
        agreement: true,
        reviewState: "accepted",
      },
    ],
    deployments: {
      technographics: {
        mode: "shadow",
        studentModel: "technographics-v2",
        threshold: 0.82,
        targetError: 0.05,
        shadowSample: 0.1,
        activeFrom: "2026-11-15T00:00:00.000Z",
      },
    },
    canaries: {
      technographics: [{ createdAt: "2026-11-20T00:00:00.000Z", provider: "openai", passed: 48, total: 50, low: 0.86, high: 0.99 }],
    },
    alerts: {
      technographics: [
        { id: "a1", kind: "canary_drop", severity: "warning", createdAt: "2026-11-21T00:00:00.000Z", ackedAt: null, payload: { provider: "openai" } },
      ],
    },
  };
}

const buckets: TrafficBucket[] = [
  { hour: "2026-11-23T00:00:00Z", total: 100, served_student: 70, deferred: 30, model_mismatch: 1, p95_student_ms: 120, p95_cloud_ms: 900 },
  { hour: "2026-11-23T01:00:00Z", total: 100, served_student: 90, deferred: 10, model_mismatch: 0, p95_student_ms: 110, p95_cloud_ms: null },
];

function stubTraffic(calls: { slug: string; hours: number }[]): TrafficStore {
  return {
    hourly: async (slug, hours) => {
      calls.push({ slug, hours });
      return slug === "technographics" ? buckets : [];
    },
  };
}

const TOKEN = "test-token";

let store: MemoryStore;
let trafficCalls: { slug: string; hours: number }[];
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = createMemoryStore(fixture());
  trafficCalls = [];
  app = createApp({ store, traffic: stubTraffic(trafficCalls), apiToken: TOKEN });
});

async function get(path: string) {
  const response = await app.request(path, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: response.status, body: await response.json() };
}

async function decide(itemId: string, body: unknown) {
  const response = await app.request(`/v1/review-queue/${itemId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function decideMany(body: unknown) {
  const response = await app.request("/v1/review-queue/decisions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe("tasks and gates", () => {
  test("health answers ok", async () => {
    expect(await get("/health")).toEqual({ status: 200, body: { ok: true } });
  });

  test("lists tasks", async () => {
    expect(await get("/v1/tasks")).toEqual({ status: 200, body: { tasks: [technographics] } });
  });

  test("returns one task", async () => {
    const { status, body } = await get("/v1/tasks/technographics");
    expect(status).toBe(200);
    expect(body.task.slug).toBe("technographics");
  });

  test("unknown task is a 404", async () => {
    expect((await get("/v1/tasks/nope")).status).toBe(404);
  });

  test("lists a task's gate history with every check", async () => {
    const { status, body } = await get("/v1/tasks/technographics/gates");
    expect(status).toBe(200);
    expect(body.gates).toEqual([
      {
        ...gate,
        evalRunId: null,
        previousEvalRunId: null,
        changes: null,
        checks: [{ ...gate.checks[0]!, estimate: null, low: null, high: null, measured: true, reason: null }],
      },
    ]);
  });
});

describe("versions", () => {
  test("lists versions newest first", async () => {
    const { status, body } = await get("/v1/tasks/technographics/versions");
    expect(status).toBe(200);
    expect(body.versions).toEqual([
      { id: "v2", version: 2, snapshotHash: "bbb", gitSha: "222", createdAt: "2026-11-10T00:00:00.000Z" },
      { id: "v1", version: 1, snapshotHash: "aaa", gitSha: "111", createdAt: "2026-11-01T00:00:00.000Z" },
    ]);
  });
});

describe("eval runs", () => {
  test("lists runs newest first with a mean, an interval and a case count", async () => {
    const { status, body } = await get("/v1/tasks/technographics/eval-runs");
    expect(status).toBe(200);
    expect(body.runs.map((run: { id: string }) => run.id)).toEqual(["run-new", "run-partial", "run-old"]);
    const newest = body.runs[0];
    expect(Object.keys(newest).sort()).toEqual(
      ["benchmark", "cases", "createdAt", "high", "id", "judgeModel", "low", "mean", "metrics", "model", "primaryMetric", "split"].sort(),
    );
    expect(newest.model).toBe("technographics-v2");
    expect(newest.cases).toBe(120);
    expect(newest.mean).toBeCloseTo(0.8);
    expect(newest.low).toBeLessThan(0.8);
    expect(newest.high).toBeGreaterThan(0.8);
    expect(newest.metrics).toEqual({});
    expect(newest.primaryMetric).toBeNull();
    expect(newest.benchmark).toBeNull();
  });

  test("compares two runs case by case", async () => {
    const { status, body } = await get("/v1/eval-runs/compare?before=run-old&after=run-new");
    expect(status).toBe(200);
    expect(body.before.id).toBe("run-old");
    expect(body.after.id).toBe("run-new");
    expect(body.difference).toBeCloseTo(0.3);
    expect(body.low).toBeGreaterThan(0);
    expect(body.verdict).toBe("better");
    expect(body.fixed).toBeGreaterThan(0);
    expect(body.broken).toBeGreaterThan(0);
    expect(body.cases).toHaveLength(120);
    expect(body.cases[0]).toEqual({ inputHash: "case-000", before: 0, after: 0, metrics: {} });
  });

  test("the reversed comparison is worse", async () => {
    const { body } = await get("/v1/eval-runs/compare?before=run-new&after=run-old");
    expect(body.verdict).toBe("worse");
    expect(body.high).toBeLessThan(0);
  });

  test("runs over different cases cannot be compared", async () => {
    const { status, body } = await get("/v1/eval-runs/compare?before=run-old&after=run-partial");
    expect(status).toBe(400);
    expect(body.error).toBe("different_cases");
  });

  test("an unknown run is a 404", async () => {
    expect((await get("/v1/eval-runs/compare?before=run-old&after=nope")).status).toBe(404);
  });

  test("both run ids are required", async () => {
    expect((await get("/v1/eval-runs/compare?before=run-old")).status).toBe(400);
  });
});

describe("review queue", () => {
  test("lists only queued items", async () => {
    const { status, body } = await get("/v1/tasks/technographics/review-queue");
    expect(status).toBe(200);
    expect(body.items).toEqual([
      {
        id: "item-1",
        inputHash: "q1",
        input: { text: "We run Snowflake and dbt" },
        teacherOutputs: { a: ["snowflake", "dbt"], b: ["snowflake"] },
        agreement: false,
        reviewState: "queued",
      },
    ]);
  });

  test("respects the limit", async () => {
    expect((await get("/v1/tasks/technographics/review-queue?limit=0")).status).toBe(400);
    const limited = await get("/v1/tasks/technographics/review-queue?limit=1");
    expect(limited.body.items).toHaveLength(1);
  });

  test("accepting an item records the review and leaves the queue", async () => {
    const { status, body } = await decide("item-1", { verdict: "accept", reviewer: "ada" });
    expect(status).toBe(200);
    expect(body.item.reviewState).toBe("accepted");
    expect(store.reviews).toEqual([{ itemId: "item-1", verdict: "accept", reviewer: "ada", correctedOutput: null }]);
    expect((await get("/v1/tasks/technographics/review-queue")).body.items).toEqual([]);
  });

  test("correcting an item stores the corrected output", async () => {
    const corrected = ["snowflake", "dbt", "airflow"];
    const { status, body } = await decide("item-1", { verdict: "correct", reviewer: "ada", correctedOutput: corrected });
    expect(status).toBe(200);
    expect(body.item.reviewState).toBe("corrected");
    expect(store.finalOutputs.get("item-1")).toEqual(corrected);
    expect(store.reviews[0]!.correctedOutput).toEqual(corrected);
  });

  test("a correction needs a corrected output", async () => {
    expect((await decide("item-1", { verdict: "correct", reviewer: "ada" })).status).toBe(400);
  });

  test("an invalid body is a 400", async () => {
    expect((await decide("item-1", { verdict: "maybe", reviewer: "ada" })).status).toBe(400);
    expect((await decide("item-1", { verdict: "accept" })).status).toBe(400);
    expect((await decide("item-1", { verdict: "accept", reviewer: "" })).status).toBe(400);
  });

  test("an unknown item is a 404", async () => {
    expect((await decide("nope", { verdict: "accept", reviewer: "ada" })).status).toBe(404);
  });
});

describe("bulk review decisions", () => {
  test("accepts every listed item and records one review each", async () => {
    const data = fixture();
    data.reviewItems!.push({ ...data.reviewItems![0]!, id: "item-3", inputHash: "q3" });
    store = createMemoryStore(data);
    app = createApp({ store, traffic: stubTraffic(trafficCalls), apiToken: TOKEN });
    const { status, body } = await decideMany({ itemIds: ["item-1", "item-3"], verdict: "accept", reviewer: "ada" });
    expect(status).toBe(200);
    expect(body.items.map((item: { id: string; reviewState: string }) => [item.id, item.reviewState])).toEqual([
      ["item-1", "accepted"],
      ["item-3", "accepted"],
    ]);
    expect(body.missing).toEqual([]);
    expect(store.reviews.map((review) => review.itemId)).toEqual(["item-1", "item-3"]);
    expect((await get("/v1/tasks/technographics/review-queue")).body.items).toEqual([]);
  });

  test("names the ids it could not find and still decides the rest", async () => {
    const { status, body } = await decideMany({ itemIds: ["item-1", "nope"], verdict: "accept", reviewer: "ada" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.missing).toEqual(["nope"]);
  });

  test("a repeated id is decided once", async () => {
    await decideMany({ itemIds: ["item-1", "item-1"], verdict: "accept", reviewer: "ada" });
    expect(store.reviews).toHaveLength(1);
  });

  test("only accept can be applied in bulk", async () => {
    expect((await decideMany({ itemIds: ["item-1"], verdict: "correct", reviewer: "ada", correctedOutput: [] })).status).toBe(400);
  });

  test("an invalid body is a 400", async () => {
    expect((await decideMany({ itemIds: [], verdict: "accept", reviewer: "ada" })).status).toBe(400);
    expect((await decideMany({ itemIds: ["item-1"], verdict: "accept", reviewer: "" })).status).toBe(400);
    expect((await decideMany({ itemIds: Array.from({ length: 501 }, (_, index) => `i${index}`), verdict: "accept", reviewer: "ada" })).status).toBe(400);
  });
});

describe("dataset items", () => {
  test("lists every item of the task with its state and final output", async () => {
    await decide("item-1", { verdict: "correct", reviewer: "ada", correctedOutput: ["snowflake", "dbt", "airflow"] });
    const { status, body } = await get("/v1/tasks/technographics/dataset-items");
    expect(status).toBe(200);
    expect(body.items.map((item: { inputHash: string; reviewState: string; finalOutput: unknown }) => [item.inputHash, item.reviewState, item.finalOutput])).toEqual([
      ["q1", "corrected", ["snowflake", "dbt", "airflow"]],
      ["q2", "accepted", null],
    ]);
  });

  test("filters by review state", async () => {
    const { body } = await get("/v1/tasks/technographics/dataset-items?state=accepted");
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["item-2"]);
    expect((await get("/v1/tasks/technographics/dataset-items?state=maybe")).status).toBe(400);
  });

  test("respects the limit", async () => {
    expect((await get("/v1/tasks/technographics/dataset-items?limit=1")).body.items).toHaveLength(1);
    expect((await get("/v1/tasks/technographics/dataset-items?limit=0")).status).toBe(400);
  });

  test("an unknown task has no items", async () => {
    expect((await get("/v1/tasks/nope/dataset-items")).body.items).toEqual([]);
  });
});

describe("deployment, traffic, canaries and alerts", () => {
  test("returns the active deployment", async () => {
    const { status, body } = await get("/v1/tasks/technographics/deployment");
    expect(status).toBe(200);
    expect(body.deployment).toEqual(fixture().deployments!["technographics"]!);
  });

  test("a task without a deployment returns null", async () => {
    expect((await get("/v1/tasks/other/deployment")).body).toEqual({ deployment: null });
  });

  test("returns hourly traffic and the overall deferral share", async () => {
    const { status, body } = await get("/v1/tasks/technographics/traffic?hours=48");
    expect(status).toBe(200);
    expect(body).toEqual({ buckets, deferralShare: 0.2 });
    expect(trafficCalls).toEqual([{ slug: "technographics", hours: 48 }]);
  });

  test("traffic defaults to 24 hours and has no share without traffic", async () => {
    expect((await get("/v1/tasks/other/traffic")).body).toEqual({ buckets: [], deferralShare: null });
    expect(trafficCalls).toEqual([{ slug: "other", hours: 24 }]);
  });

  test("traffic hours are bounded", async () => {
    expect((await get("/v1/tasks/technographics/traffic?hours=0")).status).toBe(400);
    expect((await get("/v1/tasks/technographics/traffic?hours=100000")).status).toBe(400);
  });

  test("lists canary runs", async () => {
    const { status, body } = await get("/v1/tasks/technographics/canaries");
    expect(status).toBe(200);
    expect(body.runs).toEqual(fixture().canaries!["technographics"]!);
  });

  test("lists alerts", async () => {
    const { status, body } = await get("/v1/tasks/technographics/alerts");
    expect(status).toBe(200);
    expect(body.alerts).toEqual(fixture().alerts!["technographics"]!);
  });
});

describe("cross-origin access and the contract", () => {
  test("allows the local dashboard origin", async () => {
    const response = await app.request("/v1/tasks", { headers: { origin: "http://localhost:3000" } });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("does not allow other origins", async () => {
    const response = await app.request("/v1/tasks", { headers: { origin: "https://evil.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("publishes every path and named schema in the OpenAPI document", async () => {
    const { status, body } = await get("/openapi.json");
    expect(status).toBe(200);
    expect(Object.keys(body.paths).sort()).toEqual(
      [
        "/v1/tasks",
        "/v1/tasks/{slug}",
        "/v1/tasks/{slug}/versions",
        "/v1/tasks/{slug}/gates",
        "/v1/tasks/{slug}/eval-runs",
        "/v1/eval-runs/compare",
        "/v1/eval-runs/compare/case",
        "/v1/eval-runs/{id}",
        "/v1/eval-runs/{id}/cases",
        "/v1/tasks/{slug}/review-queue",
        "/v1/tasks/{slug}/dataset-items",
        "/v1/review-queue/{itemId}/decision",
        "/v1/review-queue/decisions",
        "/v1/tasks/{slug}/deployment",
        "/v1/tasks/{slug}/traffic",
        "/v1/tasks/{slug}/canaries",
        "/v1/tasks/{slug}/alerts",
        "/v1/tasks/{slug}/review-items",
        "/v1/tasks/{slug}/train-runs",
        "/v1/tasks/{slug}/train-runs/{key}",
        "/v1/train-runs/{key}",
        "/v1/train-runs/{key}/metrics",
        "/v1/api-keys",
        "/v1/me/onboarding",
        "/v1/tasks/{slug}/datasets",
        "/v1/tasks/{slug}/datasets/{name}",
        "/v1/tasks/{slug}/datasets/{name}/versions",
        "/v1/tasks/{slug}/datasets/{name}/export",
        "/v1/tasks/{slug}/datasets/{name}/rows",
        "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}",
        "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}/history",
        "/v1/requests",
      ].sort(),
    );
    expect(Object.keys(body.components.schemas)).toEqual(
      expect.arrayContaining([
        "TaskSummary",
        "TaskVersion",
        "GateRecord",
        "EvalRun",
        "EvalComparison",
        "MetricComparison",
        "ComparedCase",
        "CaseDetail",
        "MetricHistogram",
        "MetricChange",
        "ReviewItem",
        "DatasetItem",
        "ReviewDecision",
        "Deployment",
        "TrafficBucket",
        "CanaryRun",
        "Alert",
        "TrainRun",
        "TrainRunUpsert",
        "TrainMetricsBatch",
      ]),
    );
  });
});
