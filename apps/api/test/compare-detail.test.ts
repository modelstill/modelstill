import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { signTest } from "../src/stats.ts";
import { createMemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";
const BEFORE = "11111111-1111-4111-8111-111111111111";
const AFTER = "22222222-2222-4222-8222-222222222222";
const AGGREGATE = "33333333-3333-4333-8333-333333333333";
const GATE = "44444444-4444-4444-8444-444444444444";
const WORST = "55555555-5555-4555-8555-555555555555";

const hashes = Array.from({ length: 40 }, (_, index) => `case-${String(index).padStart(3, "0")}`);

function run(id: string, score: (index: number) => number, extra: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: id === BEFORE ? "2026-11-20T00:00:00.000Z" : "2026-11-22T00:00:00.000Z",
    model: id === BEFORE ? "cloud" : "student",
    split: "gold",
    metrics: { exact_match: { value: 0.5, low: 0.35, high: 0.65 } },
    primaryMetric: "exact_match",
    cases: hashes.map((inputHash, index) => ({
      inputHash,
      score: score(index),
      output: { tags: [`${id.slice(0, 1)}-${index}`] },
      metrics: { exact_match: score(index), set_f1: score(index) * 0.5 + 0.25 },
      input: { posting: `posting ${index}` },
      expected: { tags: [`gold-${index}`] },
    })),
    ...extra,
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
  await send("PUT", "/v1/tasks/tags", { version: 1, snapshotHash: "abc", gitSha: "def", spec: {} });
  await send("POST", "/v1/tasks/tags/eval-runs", run(BEFORE, (index) => (index < 20 ? 1 : 0)));
  await send("POST", "/v1/tasks/tags/eval-runs", run(AFTER, (index) => (index < 2 ? 0 : 1), { metrics: { exact_match: { value: 0.95, low: 0.83, high: 0.99 } } }));
});

describe("sign test", () => {
  test("is exact and two-sided on fixed against broken", () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(5, 5)).toBe(1);
    expect(signTest(10, 0)).toBeCloseTo(2 / 1024, 10);
    expect(signTest(0, 10)).toBeCloseTo(2 / 1024, 10);
    expect(signTest(8, 2)).toBeCloseTo(0.109375, 10);
  });
});

describe("compare with per-metric differences", () => {
  test("pairs every metric that has per-case scores in both runs", async () => {
    const { status, body } = await get(`/v1/eval-runs/compare?before=${BEFORE}&after=${AFTER}`);
    expect(status).toBe(200);
    const names = body.metrics.map((row: { name: string }) => row.name);
    expect(names).toEqual(["exact_match", "set_f1"]);
    const exact = body.metrics[0];
    expect(exact.paired).toBe(true);
    expect(exact.before).toEqual({ value: 0.5, low: 0.35, high: 0.65 });
    expect(exact.difference).toBeCloseTo(0.45);
    expect(exact.low).toBeGreaterThan(0);
    expect(exact.high).toBeGreaterThan(exact.low);
    expect(exact.verdict).toBe("better");
    const f1 = body.metrics[1];
    expect(f1.before.value).toBeCloseTo(0.5);
    expect(f1.after.value).toBeCloseTo(0.725);
    expect(f1.before.low).toBeLessThan(f1.before.value);
    expect(f1.difference).toBeCloseTo(0.225);
  });

  test("reports the sign test and the paired case count", async () => {
    const { body } = await get(`/v1/eval-runs/compare?before=${BEFORE}&after=${AFTER}`);
    expect(body.fixed).toBe(20);
    expect(body.broken).toBe(2);
    expect(body.pairedCases).toBe(40);
    expect(body.signTest.pValue).toBeCloseTo(signTest(20, 2), 12);
    expect(body.cases[0]).toEqual({
      inputHash: "case-000",
      before: 1,
      after: 0,
      metrics: { exact_match: { before: 1, after: 0 }, set_f1: { before: 0.75, after: 0.25 } },
    });
  });

  test("a metric with only run-level values has a difference but no interval", async () => {
    const aggregate = run(AGGREGATE, (index) => (index < 30 ? 1 : 0), {
      metrics: { exact_match: { value: 0.75, low: 0.6, high: 0.86 } },
      cases: hashes.map((inputHash, index) => ({ inputHash, score: index < 30 ? 1 : 0, output: null })),
    });
    await send("POST", "/v1/tasks/tags/eval-runs", aggregate);
    const { body } = await get(`/v1/eval-runs/compare?before=${BEFORE}&after=${AGGREGATE}`);
    expect(body.metrics).toHaveLength(1);
    const [row] = body.metrics;
    expect(row).toMatchObject({ name: "exact_match", paired: false, low: null, high: null, verdict: null });
    expect(row.difference).toBeCloseTo(0.25);
  });
});

describe("one case side by side", () => {
  test("returns the input, the expected answer and both outputs with their scores", async () => {
    const { status, body } = await get(`/v1/eval-runs/compare/case?before=${BEFORE}&after=${AFTER}&inputHash=case-001`);
    expect(status).toBe(200);
    expect(body.case).toEqual({
      inputHash: "case-001",
      input: { posting: "posting 1" },
      expected: { tags: ["gold-1"] },
      before: { score: 1, output: { tags: ["1-1"] }, metrics: { exact_match: 1, set_f1: 0.75 } },
      after: { score: 0, output: { tags: ["2-1"] }, metrics: { exact_match: 0, set_f1: 0.25 } },
    });
  });

  test("a case pushed without detail answers with nulls", async () => {
    await send("POST", "/v1/tasks/tags/eval-runs", {
      ...run(AGGREGATE, () => 1),
      cases: hashes.map((inputHash) => ({ inputHash, score: 1 })),
    });
    const { body } = await get(`/v1/eval-runs/compare/case?before=${AGGREGATE}&after=${AFTER}&inputHash=case-005`);
    expect(body.case.input).toEqual({ posting: "posting 5" });
    expect(body.case.before).toEqual({ score: 1, output: null, metrics: {} });
  });

  test("an unknown case or run is a 404", async () => {
    expect((await get(`/v1/eval-runs/compare/case?before=${BEFORE}&after=${AFTER}&inputHash=nope`)).status).toBe(404);
    expect((await get(`/v1/eval-runs/compare/case?before=${BEFORE}&after=${GATE}&inputHash=case-001`)).status).toBe(404);
  });
});

describe("gate checks carry their interval and why they were not measured", () => {
  test("the lower bound and the regression checks get the interval they were read from", async () => {
    await send("POST", "/v1/tasks/tags/gates", {
      id: GATE,
      evalRunId: AFTER,
      previousEvalRunId: BEFORE,
      passed: true,
      checks: [
        { name: "metric_lower_bound", threshold: 0.3, value: 0.35, passed: true },
        { name: "regression_vs_baseline", threshold: -0.02, value: 0.3, passed: true },
        { name: "flip_rate", threshold: 0.01, value: 0.004, passed: true },
      ],
      report: {},
    });
    const [gate] = (await get("/v1/tasks/tags/gates")).body.gates;
    expect(gate.evalRunId).toBe(AFTER);
    expect(gate.previousEvalRunId).toBe(BEFORE);
    const [lower, regression, flip] = gate.checks;
    expect(lower).toMatchObject({ estimate: 0.95, low: 0.83, high: 0.99, measured: true, reason: null });
    expect(regression.estimate).toBeCloseTo(0.45);
    expect(regression.low).toBeGreaterThan(0);
    expect(regression.measured).toBe(true);
    expect(flip).toMatchObject({ estimate: null, low: null, high: null, measured: true, reason: null });
  });

  test("a check at the documented worst-case value is shown as not measured, with the reason", async () => {
    await send("POST", "/v1/tasks/tags/gates", {
      id: WORST,
      evalRunId: AFTER,
      passed: false,
      checks: [
        { name: "flip_rate", threshold: 0.01, value: 1, passed: false },
        { name: "cost_ratio", threshold: 0.5, value: 9, passed: false },
        { name: "p95_latency_ms", threshold: 800, value: 99999, passed: false },
        { name: "judge_human_kappa", threshold: 0.6, value: 0, passed: false, measured: false, reason: "no human labels yet" },
        { name: "metric_lower_bound", threshold: 0.9, value: 0.35, passed: false },
      ],
      report: { notMeasured: { cost_ratio: "the provider bill for the window was not exported" } },
    });
    const [gate] = (await get("/v1/tasks/tags/gates")).body.gates;
    const byName = Object.fromEntries(gate.checks.map((check: { name: string }) => [check.name, check]));
    expect(byName["flip_rate"].measured).toBe(false);
    expect(byName["flip_rate"].reason).toContain("worst-case");
    expect(byName["cost_ratio"]).toMatchObject({ measured: false, reason: "the provider bill for the window was not exported" });
    expect(byName["p95_latency_ms"].measured).toBe(false);
    expect(byName["judge_human_kappa"]).toMatchObject({ measured: false, reason: "no human labels yet" });
    expect(byName["metric_lower_bound"].measured).toBe(true);
  });
});
