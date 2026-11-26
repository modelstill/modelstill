import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { histogram, histogramsFor } from "../src/histogram.ts";
import { createMemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";
const BEFORE = "11111111-1111-4111-8111-111111111111";
const AFTER = "22222222-2222-4222-8222-222222222222";
const GATE = "44444444-4444-4444-8444-444444444444";
const MISSING = "99999999-9999-4999-8999-999999999999";

const hashes = Array.from({ length: 20 }, (_, index) => `case-${String(index).padStart(3, "0")}`);

function run(id: string, score: (index: number) => number, f1: (index: number) => number) {
  return {
    id,
    createdAt: id === BEFORE ? "2026-11-20T00:00:00.000Z" : "2026-11-22T00:00:00.000Z",
    model: id === BEFORE ? "cloud" : "student",
    split: "gold",
    metrics: { exact_match: { value: 0.5, low: 0.3, high: 0.7 } },
    primaryMetric: "exact_match",
    cases: hashes.map((inputHash, index) => ({
      inputHash,
      score: score(index),
      output: { answer: `${id.slice(0, 1)}-${index}` },
      metrics: { exact_match: score(index), set_f1: f1(index) },
      input: { question: `question ${index}` },
      expected: { answer: `gold-${index}` },
    })),
  };
}

let app: ReturnType<typeof createApp>;

async function send(method: string, path: string, body: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function get(path: string) {
  const response = await app.request(path, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  app = createApp({ store: createMemoryStore(), apiToken: TOKEN });
  await send("PUT", "/v1/tasks/capitals", { version: 1, snapshotHash: "abc", gitSha: "def", spec: {} });
  await send("POST", "/v1/tasks/capitals/eval-runs", run(BEFORE, (index) => (index < 10 ? 1 : 0), () => 0.5));
  await send(
    "POST",
    "/v1/tasks/capitals/eval-runs",
    run(AFTER, (index) => (index < 3 ? 0 : 1), (index) => (index < 4 ? 0.25 : index < 12 ? 0.5 : 0.75)),
  );
});

describe("histogram", () => {
  test("scores between 0 and 1 fall in ten equal bins over [0, 1], the top value in the last bin", () => {
    const bins = histogram([0, 0.05, 0.1, 0.55, 1, 1]);
    expect(bins).toHaveLength(10);
    expect(bins[0]).toEqual({ low: 0, high: 0.1, count: 2 });
    expect(bins[1]!.count).toBe(1);
    expect(bins[5]!.count).toBe(1);
    expect(bins[9]).toEqual({ low: 0.9, high: 1, count: 2 });
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(6);
  });

  test("values outside [0, 1] span their own range", () => {
    const bins = histogram([2, 4, 12]);
    expect(bins[0]!.low).toBe(2);
    expect(bins[9]!.high).toBe(12);
    expect(bins[0]!.count).toBe(1);
    expect(bins[2]!.count).toBe(1);
    expect(bins[9]!.count).toBe(1);
  });

  test("a single repeated value outside [0, 1] is one bin", () => {
    expect(histogram([3, 3])).toEqual([{ low: 3, high: 3, count: 2 }]);
  });

  test("no values, no bins", () => {
    expect(histogram([])).toEqual([]);
  });

  test("one histogram for the case score, then one per metric every case logged", () => {
    const result = histogramsFor([
      { inputHash: "a", score: 1, metrics: { set_f1: 0.5, exact_match: 1 } },
      { inputHash: "b", score: 0, metrics: { set_f1: 0.25 } },
    ]);
    expect(result.map((entry) => entry.metric)).toEqual(["score", "set_f1"]);
    expect(result[0]!.bins[0]!.count).toBe(1);
  });
});

describe("GET /v1/eval-runs/{id}", () => {
  test("returns the run with a histogram per metric", async () => {
    const { status, body } = await get(`/v1/eval-runs/${AFTER}`);
    expect(status).toBe(200);
    expect(body.run.id).toBe(AFTER);
    expect(body.run.cases).toBe(20);
    expect(body.histograms.map((entry: { metric: string }) => entry.metric)).toEqual(["score", "exact_match", "set_f1"]);
    const f1 = body.histograms[2].bins;
    expect(f1[2].count).toBe(4);
    expect(f1[5].count).toBe(8);
    expect(f1[7].count).toBe(8);
  });

  test("accepts an id without dashes", async () => {
    expect((await get(`/v1/eval-runs/${AFTER.replaceAll("-", "")}`)).body.run.id).toBe(AFTER);
  });

  test("an unknown run is a 404", async () => {
    expect((await get(`/v1/eval-runs/${MISSING}`)).status).toBe(404);
  });
});

describe("GET /v1/eval-runs/{id}/cases", () => {
  test("lists every case with input, output, expected and scores, worst score first", async () => {
    const { status, body } = await get(`/v1/eval-runs/${AFTER}/cases`);
    expect(status).toBe(200);
    expect(body.total).toBe(20);
    expect(body.cases).toHaveLength(20);
    expect(body.cases.slice(0, 3).map((entry: { inputHash: string }) => entry.inputHash)).toEqual(["case-000", "case-001", "case-002"]);
    expect(body.cases[0]).toEqual({
      inputHash: "case-000",
      score: 0,
      input: { question: "question 0" },
      output: { answer: "2-0" },
      expected: { answer: "gold-0" },
      metrics: { exact_match: 0, set_f1: 0.25 },
    });
    expect(body.cases[3].score).toBe(1);
  });

  test("pages with offset and limit and keeps the total", async () => {
    const { body } = await get(`/v1/eval-runs/${AFTER}/cases?offset=18&limit=5`);
    expect(body.total).toBe(20);
    expect(body.offset).toBe(18);
    expect(body.cases).toHaveLength(2);
  });

  test("a limit above 500 is refused", async () => {
    expect((await get(`/v1/eval-runs/${AFTER}/cases?limit=501`)).status).toBe(400);
  });

  test("an unknown run is a 404", async () => {
    expect((await get(`/v1/eval-runs/${MISSING}/cases`)).status).toBe(404);
  });
});

describe("improved and regressed cases per metric", () => {
  test("every paired metric counts the cases that went up and down against the baseline", async () => {
    const { body } = await get(`/v1/eval-runs/compare?before=${BEFORE}&after=${AFTER}`);
    const byName = Object.fromEntries(body.metrics.map((row: { name: string }) => [row.name, row]));
    expect(byName["exact_match"]).toMatchObject({ improved: 10, regressed: 3 });
    expect(byName["set_f1"]).toMatchObject({ improved: 8, regressed: 4 });
  });

  test("each case carries its paired metric values so the table can filter by metric", async () => {
    const { body } = await get(`/v1/eval-runs/compare?before=${BEFORE}&after=${AFTER}`);
    expect(body.cases[0]).toEqual({
      inputHash: "case-000",
      before: 1,
      after: 0,
      metrics: { exact_match: { before: 1, after: 0 }, set_f1: { before: 0.5, after: 0.25 } },
    });
  });

  test("a metric without per-case values has no counts", async () => {
    const aggregate = "33333333-3333-4333-8333-333333333333";
    await send("POST", "/v1/tasks/capitals/eval-runs", {
      ...run(aggregate, () => 1, () => 1),
      cases: hashes.map((inputHash) => ({ inputHash, score: 1 })),
    });
    const { body } = await get(`/v1/eval-runs/compare?before=${BEFORE}&after=${aggregate}`);
    expect(body.metrics[0]).toMatchObject({ name: "exact_match", improved: null, regressed: null });
    expect(body.cases[0].metrics).toEqual({});
  });

  test("a gate with a baseline carries the same counts, the case score first", async () => {
    await send("POST", "/v1/tasks/capitals/gates", {
      id: GATE,
      evalRunId: AFTER,
      previousEvalRunId: BEFORE,
      passed: true,
      checks: [{ name: "metric_lower_bound", threshold: 0.3, value: 0.35, passed: true }],
      report: {},
    });
    const [gate] = (await get("/v1/tasks/capitals/gates")).body.gates;
    expect(gate.changes).toEqual([
      { name: "score", improved: 10, regressed: 3 },
      { name: "exact_match", improved: 10, regressed: 3 },
      { name: "set_f1", improved: 8, regressed: 4 },
    ]);
  });

  test("a gate without a baseline has no counts", async () => {
    await send("POST", "/v1/tasks/capitals/gates", { id: GATE, evalRunId: AFTER, passed: true, checks: [], report: {} });
    const [gate] = (await get("/v1/tasks/capitals/gates")).body.gates;
    expect(gate.changes).toBeNull();
  });
});
