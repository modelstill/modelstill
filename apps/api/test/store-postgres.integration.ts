import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema.ts";
import { DEMO_CASES, DEMO_QUEUED, removeTask, seedDemo } from "../src/demo.ts";
import { compareScores } from "../src/stats.ts";
import { createPostgresStore } from "../src/store-postgres.ts";
import type { EvalRunCreate, Store } from "../src/store.ts";

const url = process.env["DATABASE_URL"];

describe.skipIf(!url)("postgres store", () => {
  const slug = `it-${crypto.randomUUID().slice(0, 8)}`;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let store: Store;

  beforeAll(async () => {
    client = postgres(url!, { max: 2, onnotice: () => {} });
    db = drizzle(client, { schema });
    await seedDemo(db, { slug });
    store = createPostgresStore(db);
  });

  afterAll(async () => {
    await removeTask(db, slug);
    await client.end();
  });

  test("summarises the task from its current version, deployment and last gate", async () => {
    const task = await store.getTask(slug);
    expect(task).toMatchObject({ slug, version: 2, mode: "shadow", lastGatePassed: true, deferralShare: null });
    expect((await store.listTasks()).map((entry) => entry.slug)).toContain(slug);
    expect(await store.getTask(`${slug}-missing`)).toBeNull();
  });

  test("lists versions newest first", async () => {
    const versions = await store.listVersions(slug);
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(Object.keys(versions[0]!).sort()).toEqual(["createdAt", "gitSha", "id", "snapshotHash", "version"]);
  });

  test("lists gates newest first with every check", async () => {
    const gates = await store.listGates(slug);
    expect(gates.map((gate) => gate.passed)).toEqual([true, false]);
    expect(gates[0]!.taskSlug).toBe(slug);
    expect(gates[0]!.checks.length).toBeGreaterThan(1);
    expect(Object.keys(gates[0]!.checks[0]!).sort()).toEqual(["name", "passed", "threshold", "value"]);
  });

  test("lists eval runs with the served model name or cloud alias and an interval", async () => {
    const runs = await store.listEvalRuns(slug);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.createdAt)).toEqual(runs.map((run) => run.createdAt).sort().reverse());
    expect(new Set(runs.map((run) => run.model)).size).toBe(3);
    for (const run of runs) {
      expect(run.cases).toBe(DEMO_CASES);
      expect(run.low).toBeLessThanOrEqual(run.mean);
      expect(run.high).toBeGreaterThanOrEqual(run.mean);
    }
  });

  test("returns a run's per-case scores for comparison", async () => {
    const [newest, , oldest] = await store.listEvalRuns(slug);
    const after = await store.getEvalRunWithScores(newest!.id);
    const before = await store.getEvalRunWithScores(oldest!.id);
    expect(after!.scores).toHaveLength(DEMO_CASES);
    expect(compareScores(before!.scores, after!.scores).cases).toHaveLength(DEMO_CASES);
    expect(await store.getEvalRunWithScores(crypto.randomUUID())).toBeNull();
    expect(await store.getEvalRunWithScores("not-a-uuid")).toBeNull();
  });

  test("lists the review queue with a limit", async () => {
    expect(await store.listReviewQueue(slug, 50)).toHaveLength(DEMO_QUEUED);
    const limited = await store.listReviewQueue(slug, 5);
    expect(limited).toHaveLength(5);
    expect(limited.every((item) => item.reviewState === "queued")).toBe(true);
  });

  test("accepting an item writes a review and takes it off the queue", async () => {
    const [item] = await store.listReviewQueue(slug, 1);
    const decided = await store.decideReview(item!.id, { verdict: "accept", reviewer: "integration" });
    expect(decided).toMatchObject({ id: item!.id, reviewState: "accepted" });
    expect(await store.listReviewQueue(slug, 50)).toHaveLength(DEMO_QUEUED - 1);
    const rows = await db.select().from(schema.reviews).where(eq(schema.reviews.itemId, item!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "accept", reviewer: "integration", kind: "label" });
  });

  test("correcting an item stores the final output and its hash", async () => {
    const [item] = await store.listReviewQueue(slug, 1);
    const correctedOutput = ["postgres", "kafka"];
    const decided = await store.decideReview(item!.id, { verdict: "correct", reviewer: "integration", correctedOutput });
    expect(decided!.reviewState).toBe("corrected");
    const [row] = await db.select().from(schema.datasetItems).where(eq(schema.datasetItems.id, item!.id));
    expect(row!.finalOutput).toEqual(correctedOutput);
    expect(row!.finalOutputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("lists dataset items with their final output, filtered by state", async () => {
    const [item] = await store.listReviewQueue(slug, 1);
    await store.decideReview(item!.id, { verdict: "correct", reviewer: "integration", correctedOutput: ["dbt"] });
    const corrected = await store.listDatasetItems(slug, { state: "corrected", limit: 500 });
    expect(corrected.find((entry) => entry.id === item!.id)).toMatchObject({ reviewState: "corrected", finalOutput: ["dbt"] });
    expect((await store.listDatasetItems(slug, { limit: 3 })).length).toBeLessThanOrEqual(3);
  });

  test("an unknown item is null", async () => {
    expect(await store.decideReview(crypto.randomUUID(), { verdict: "accept", reviewer: "x" })).toBeNull();
    expect(await store.decideReview("nope", { verdict: "accept", reviewer: "x" })).toBeNull();
  });

  test("returns the deployment, canaries and alerts", async () => {
    expect(await store.getDeployment(slug)).toMatchObject({ mode: "shadow", targetError: 0.05, shadowSample: 0.1 });
    expect(await store.getDeployment(`${slug}-missing`)).toBeNull();
    const canaries = await store.listCanaries(slug);
    expect(canaries.length).toBeGreaterThan(0);
    expect(canaries[0]!.createdAt >= canaries.at(-1)!.createdAt).toBe(true);
    const alerts = await store.listAlerts(slug);
    expect(alerts).toHaveLength(2);
    expect(alerts.some((alert) => alert.ackedAt === null)).toBe(true);
  });

  test("seeding again replaces the demo instead of duplicating it", async () => {
    await seedDemo(db, { slug });
    expect(await store.listEvalRuns(slug)).toHaveLength(3);
    expect(await store.listReviewQueue(slug, 500)).toHaveLength(DEMO_QUEUED);
  });
});

describe.skipIf(!url)("postgres store writes", () => {
  const slug = `it-push-${crypto.randomUUID().slice(0, 8)}`;
  const runId = crypto.randomUUID().replaceAll("-", "");
  const otherRunId = crypto.randomUUID();
  const gateId = crypto.randomUUID();
  const hashes = Array.from({ length: 40 }, (_, index) => `case-${String(index).padStart(3, "0")}`);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let store: Store;

  const run = (id: string, score: (index: number) => number, primary: boolean): EvalRunCreate => ({
    id,
    createdAt: primary ? "2026-11-23T13:27:48.259Z" : "2026-11-23T11:21:10.998Z",
    model: "technographics",
    split: "gold",
    judgeModel: "",
    benchmark: { name: "tech_gold", version: "d9c454a2" },
    metrics: primary ? { pooled_f1: { value: 0.819, low: 0.78, high: 0.855 } } : {},
    primaryMetric: primary ? "pooled_f1" : null,
    cases: hashes.map((inputHash, index) => ({ inputHash, score: score(index), output: [`tech-${index}`] })),
  });

  beforeAll(async () => {
    client = postgres(url!, { max: 2, onnotice: () => {} });
    db = drizzle(client, { schema });
    store = createPostgresStore(db);
  });

  afterAll(async () => {
    await removeTask(db, slug);
    await client.end();
  });

  test("an unknown task refuses runs, gates, review items and deployments", async () => {
    expect(await store.createEvalRun(slug, run(runId, () => 1, true))).toBeNull();
    expect(await store.upsertReviewItems(slug, [])).toBeNull();
    const off = { mode: "off" as const, studentModel: null, threshold: null, targetError: 0.05, shadowSample: 0.1, activeFrom: null };
    expect(await store.setDeployment(slug, off)).toBeNull();
    const gate = { id: gateId, evalRunId: runId, previousEvalRunId: null, passed: true, checks: [], report: {} };
    expect(await store.recordGate(slug, gate)).toBe("task_not_found");
  });

  test("upserting a task registers each snapshot once and makes the newest current", async () => {
    const first = await store.upsertTask(slug, { version: 1, snapshotHash: "aaa", gitSha: "111", spec: { task: slug } });
    expect(first.task).toMatchObject({ slug, version: 1, snapshotHash: "aaa", mode: "off" });
    await store.upsertTask(slug, { version: 1, snapshotHash: "aaa", gitSha: "111", spec: { task: slug } });
    const second = await store.upsertTask(slug, { version: 2, snapshotHash: "bbb", gitSha: "222", spec: { task: slug } });
    expect(second.task.version).toBe(2);
    expect((await store.listVersions(slug)).map((version) => version.version)).toEqual([2, 1]);
    const again = await store.upsertTask(slug, { version: 1, snapshotHash: "aaa", gitSha: "111", spec: { task: slug } });
    expect(again.task.version).toBe(1);
    await store.upsertTask(slug, { version: 2, snapshotHash: "bbb", gitSha: "222", spec: { task: slug } });
  });

  test("a pushed run shows its primary metric and keeps per-case scores for compare", async () => {
    const created = await store.createEvalRun(slug, run(runId, (index) => (index % 4 === 0 ? 0 : 1), true));
    expect(created!.created).toBe(true);
    expect(created!.value).toMatchObject({
      model: "technographics",
      mean: 0.819,
      low: 0.78,
      high: 0.855,
      cases: 40,
      primaryMetric: "pooled_f1",
      metrics: { pooled_f1: { value: 0.819, low: 0.78, high: 0.855 } },
      benchmark: { name: "tech_gold", version: "d9c454a2" },
    });
    expect(created!.value.id.replaceAll("-", "")).toBe(runId);
    const again = await store.createEvalRun(slug, run(runId, () => 1, true));
    expect(again).toEqual({ value: created!.value, created: false });

    const fallback = await store.createEvalRun(slug, run(otherRunId, () => 1, false));
    expect(fallback!.value).toMatchObject({ mean: 1, primaryMetric: null, metrics: {} });

    const runs = await store.listEvalRuns(slug);
    expect(runs.map((entry) => entry.id)).toEqual([created!.value.id, otherRunId]);
    const before = await store.getEvalRunWithScores(otherRunId);
    const after = await store.getEvalRunWithScores(runId);
    expect(after!.run.id).toBe(created!.value.id);
    const comparison = compareScores(before!.scores, after!.scores);
    expect(comparison.broken).toBe(10);
    expect(comparison.cases).toHaveLength(40);

    const page = await store.listEvalCases(runId, { offset: 0, limit: 15 });
    expect(page!.total).toBe(40);
    expect(page!.cases).toHaveLength(15);
    expect(page!.cases.slice(0, 10).every((entry) => entry.score === 0)).toBe(true);
    expect(page!.cases[10]!.score).toBe(1);
    expect(await store.listEvalCases(crypto.randomUUID(), { offset: 0, limit: 5 })).toBeNull();
  });

  test("records a gate once, against known runs only", async () => {
    const input = {
      id: gateId,
      evalRunId: runId,
      previousEvalRunId: otherRunId,
      passed: false,
      checks: [{ name: "metric_lower_bound", threshold: 0.81, value: 0.78, passed: false }],
      report: { passed: false },
    };
    const recorded = await store.recordGate(slug, input);
    expect(recorded).toMatchObject({ created: true, value: { id: gateId, taskSlug: slug, passed: false } });
    expect(await store.recordGate(slug, input)).toMatchObject({ created: false });
    const unknownRun = { ...input, id: crypto.randomUUID(), evalRunId: crypto.randomUUID() };
    expect(await store.recordGate(slug, unknownRun)).toBe("run_not_found");
    expect(await store.listGates(slug)).toHaveLength(1);
    expect((await store.getTask(slug))!.lastGatePassed).toBe(false);
    const [row] = await db.select().from(schema.gates).where(eq(schema.gates.id, gateId));
    expect(row!.previousEvalRunId).toBe(otherRunId);
    expect(row!.report).toEqual({ passed: false });
  });

  test("upserts review items by input hash and never overwrites a human decision", async () => {
    const items = [
      { inputHash: "q1", input: { posting: "Snowflake" }, teacherOutputs: { a: ["snowflake"], b: [] }, agreement: false, reviewState: "queued" as const },
      { inputHash: "q2", input: { posting: "Kafka" }, teacherOutputs: { a: ["kafka"], b: ["kafka"] }, agreement: true, reviewState: "none" as const },
    ];
    expect(await store.upsertReviewItems(slug, items)).toBe(2);
    const [queued] = await store.listReviewQueue(slug, 50);
    expect(queued).toMatchObject({ inputHash: "q1", reviewState: "queued" });
    await store.decideReview(queued!.id, { verdict: "accept", reviewer: "integration" });
    expect(await store.upsertReviewItems(slug, items)).toBe(2);
    expect(await store.listReviewQueue(slug, 50)).toEqual([]);
  });

  test("sets the deployment the read side and the task summary return", async () => {
    const deployment = await store.setDeployment(slug, {
      mode: "shadow",
      studentModel: "technographics-v1",
      threshold: 0.8,
      targetError: 0.05,
      shadowSample: 0.2,
      activeFrom: null,
    });
    expect(deployment).toMatchObject({ mode: "shadow", studentModel: "technographics-v1", shadowSample: 0.2 });
    expect(await store.getDeployment(slug)).toEqual(deployment);
    expect((await store.getTask(slug))!.mode).toBe("shadow");
  });

  test("records canary runs and alerts once per id and lists them back", async () => {
    const canaryId = crypto.randomUUID();
    const canary = { createdAt: "2026-11-25T10:00:00.000Z", provider: "p", passed: 9, total: 10, low: 0.55, high: 0.99 };
    expect(await store.recordCanaries(`${slug}-missing`, [{ ...canary, id: null }])).toBeNull();
    expect(await store.recordCanaries(slug, [{ ...canary, id: canaryId }, { ...canary, id: null }])).toBe(2);
    expect(await store.recordCanaries(slug, [{ ...canary, id: canaryId }])).toBe(0);
    expect(await store.listCanaries(slug)).toEqual([canary, canary]);
    const alertId = crypto.randomUUID();
    const alert = { kind: "watch_logprob_shift", severity: "warn", createdAt: "2026-11-25T10:00:01.000Z", payload: { message: "m" } };
    expect(await store.recordAlerts(slug, [{ ...alert, id: alertId }])).toBe(1);
    expect(await store.recordAlerts(slug, [{ ...alert, id: alertId }])).toBe(0);
    expect(await store.listAlerts(slug)).toEqual([{ ...alert, id: alertId, ackedAt: null }]);
  });
});

describe.skipIf(!url)("postgres store train runs", () => {
  const slug = `it-train-${crypto.randomUUID().slice(0, 8)}`;
  const key = `${slug}-9256c08a-a41fcbab-s1`;
  const laterKey = `${slug}-9256c08a-a41fcbab-s2`;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let store: Store;

  beforeAll(async () => {
    client = postgres(url!, { max: 2, onnotice: () => {} });
    db = drizzle(client, { schema });
    store = createPostgresStore(db);
  });

  afterAll(async () => {
    await db.delete(schema.trainRuns).where(eq(schema.trainRuns.taskSlug, slug));
    await client.end();
  });

  const running = {
    base: "Qwen/Qwen3-4B",
    method: "lora",
    status: "running" as const,
    manifest: { snapshot: "9256c08a" },
    startedAt: "2026-11-24T08:00:00.000Z",
  };

  test("upserts a run and keeps fields a later update leaves out", async () => {
    const created = await store.upsertTrainRun(slug, key, running);
    expect(created).toEqual({
      key,
      taskSlug: slug,
      base: "Qwen/Qwen3-4B",
      method: "lora",
      status: "running",
      manifest: { snapshot: "9256c08a" },
      attestation: null,
      finalMetrics: null,
      startedAt: "2026-11-24T08:00:00.000Z",
      finishedAt: null,
    });
    const finished = await store.upsertTrainRun(slug, key, {
      base: "Qwen/Qwen3-4B",
      method: "lora",
      status: "succeeded",
      finalMetrics: { eval_loss: 0.42 },
      attestation: { train: { rows: 10 } },
    });
    expect(finished).toMatchObject({
      status: "succeeded",
      manifest: { snapshot: "9256c08a" },
      attestation: { train: { rows: 10 } },
      finalMetrics: { eval_loss: 0.42 },
      startedAt: "2026-11-24T08:00:00.000Z",
    });
    expect(typeof (finished as { finishedAt: unknown }).finishedAt).toBe("string");
    expect(await store.upsertTrainRun(`${slug}-other`, key, running)).toBe("task_mismatch");
  });

  test("stores metric points once per step and name and groups them by name", async () => {
    expect(await store.recordTrainMetrics(`${key}-missing`, [{ step: 1, epoch: null, name: "loss", value: 1 }])).toBeNull();
    const points = [
      { step: 20, epoch: 0.2, name: "loss", value: 1.1 },
      { step: 10, epoch: 0.1, name: "loss", value: 1.4 },
      { step: 20, epoch: 0.2, name: "eval_loss", value: 0.9 },
      { step: 20, epoch: 0.2, name: "loss", value: 1.0 },
    ];
    expect(await store.recordTrainMetrics(key, points)).toBe(3);
    expect(await store.recordTrainMetrics(key, points)).toBe(3);
    const found = await store.getTrainRun(key);
    expect(found!.run.key).toBe(key);
    expect(found!.series).toEqual({
      eval_loss: [{ step: 20, epoch: 0.2, value: 0.9 }],
      loss: [
        { step: 10, epoch: 0.1, value: 1.4 },
        { step: 20, epoch: 0.2, value: 1.0 },
      ],
    });
    expect(await store.getTrainRun(`${key}-missing`)).toBeNull();
  });

  test("lists a task's runs newest first", async () => {
    await store.upsertTrainRun(slug, laterKey, { ...running, startedAt: "2026-11-24T10:00:00.000Z" });
    expect((await store.listTrainRuns(slug)).map((run) => run.key)).toEqual([laterKey, key]);
    expect(await store.listTrainRuns(`${slug}-none`)).toEqual([]);
  });
});
