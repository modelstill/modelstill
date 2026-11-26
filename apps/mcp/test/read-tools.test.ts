import { describe, expect, test } from "bun:test";
import * as fx from "./fixtures.ts";
import { callTool, connect, TEST_KEY } from "./harness.ts";
import { stubRoutes } from "./stub.ts";

const SLUG = fx.task.slug;

describe("task tools", () => {
  test("list_tasks returns every task and forwards the caller's key", async () => {
    const stub = stubRoutes({ "GET /v1/tasks": { status: 200, body: { tasks: [fx.task] } } });
    const answer = await callTool(await connect(stub), "list_tasks");
    expect(answer.isError).toBe(false);
    expect(answer.structured).toEqual({ tasks: [fx.task] });
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  test("get_task returns the task with its versions", async () => {
    const stub = stubRoutes({
      [`GET /v1/tasks/${SLUG}`]: { status: 200, body: { task: fx.task } },
      [`GET /v1/tasks/${SLUG}/versions`]: { status: 200, body: { versions: [fx.version] } },
    });
    const answer = await callTool(await connect(stub), "get_task", { task: SLUG });
    expect(answer.structured).toEqual({ task: fx.task, versions: [fx.version] });
  });

  test("get_task on an unknown slug is an error pointing at list_tasks", async () => {
    const stub = stubRoutes({});
    const answer = await callTool(await connect(stub), "get_task", { task: "nope" });
    expect(answer.isError).toBe(true);
    expect(answer.body.error).toBe("not_found");
    expect(answer.body.retryable).toBe(false);
    expect(String(answer.body.next_step)).toContain("list_tasks");
  });

  test("an unknown argument is refused before any API call", async () => {
    const stub = stubRoutes({});
    const answer = await callTool(await connect(stub), "get_task", { task: SLUG, slug: SLUG });
    expect(answer.isError).toBe(true);
    expect(answer.body.error).toBe("unknown_arguments");
    expect(answer.body.unknown_arguments).toEqual(["slug"]);
    expect(stub.requests).toHaveLength(0);
  });

  test("an argument on a tool that takes none is refused too", async () => {
    const stub = stubRoutes({});
    const answer = await callTool(await connect(stub), "list_tasks", { limit: 3 });
    expect(answer.body.error).toBe("unknown_arguments");
    expect(stub.requests).toHaveLength(0);
  });
});

describe("eval tools", () => {
  test("list_eval_runs returns the newest runs up to limit with the total", async () => {
    const runs = [fx.evalRun("r3", 0.9), fx.evalRun("r2", 0.85), fx.evalRun("r1", 0.8)];
    const stub = stubRoutes({ [`GET /v1/tasks/${SLUG}/eval-runs`]: { status: 200, body: { runs } } });
    const answer = await callTool(await connect(stub), "list_eval_runs", { task: SLUG, limit: 2 });
    expect(answer.structured).toEqual({ runs: runs.slice(0, 2), total: 3 });
  });

  test("compare_runs returns the paired difference with its interval and fixed/broken, without the case list", async () => {
    const stub = stubRoutes({ "GET /v1/eval-runs/compare?before=r1&after=r2": { status: 200, body: fx.comparison } });
    const answer = await callTool(await connect(stub), "compare_runs", { before: "r1", after: "r2" });
    const { cases: _cases, ...rest } = fx.comparison;
    expect(answer.structured).toEqual({ ...rest, paired_cases: 2 });
  });

  test("compare_runs on runs over different cases explains why", async () => {
    const stub = stubRoutes({ "GET /v1/eval-runs/compare?before=r1&after=r2": { status: 400, body: { error: "different_cases" } } });
    const answer = await callTool(await connect(stub), "compare_runs", { before: "r1", after: "r2" });
    expect(answer.isError).toBe(true);
    expect(answer.body.error).toBe("different_cases");
    expect(String(answer.body.next_step)).toContain("same cases");
  });

  test("list_gates returns each gate with every check", async () => {
    const stub = stubRoutes({ [`GET /v1/tasks/${SLUG}/gates`]: { status: 200, body: { gates: [fx.gate] } } });
    const answer = await callTool(await connect(stub), "list_gates", { task: SLUG });
    expect(answer.structured).toEqual({ gates: [fx.gate], total: 1 });
  });
});

describe("review and serving tools", () => {
  test("get_review_queue passes limit through", async () => {
    const stub = stubRoutes({ [`GET /v1/tasks/${SLUG}/review-queue?limit=5`]: { status: 200, body: { items: [fx.reviewItem] } } });
    const answer = await callTool(await connect(stub), "get_review_queue", { task: SLUG, limit: 5 });
    expect(answer.structured).toEqual({ items: [fx.reviewItem] });
  });

  test("get_review_queue defaults to 20 items", async () => {
    const stub = stubRoutes({ [`GET /v1/tasks/${SLUG}/review-queue?limit=20`]: { status: 200, body: { items: [] } } });
    const answer = await callTool(await connect(stub), "get_review_queue", { task: SLUG });
    expect(answer.isError).toBe(false);
  });

  test("get_deployment returns the deployment or null", async () => {
    const stub = stubRoutes({ [`GET /v1/tasks/${SLUG}/deployment`]: { status: 200, body: { deployment: fx.deployment } } });
    expect((await callTool(await connect(stub), "get_deployment", { task: SLUG })).structured).toEqual({ deployment: fx.deployment });
    const none = stubRoutes({ [`GET /v1/tasks/${SLUG}/deployment`]: { status: 200, body: { deployment: null } } });
    expect((await callTool(await connect(none), "get_deployment", { task: SLUG })).structured).toEqual({ deployment: null });
  });

  test("get_traffic returns hourly buckets, the deferral share and totals", async () => {
    const stub = stubRoutes({
      [`GET /v1/tasks/${SLUG}/traffic?hours=48`]: { status: 200, body: { buckets: fx.trafficBuckets, deferralShare: 25 / 150 } },
    });
    const answer = await callTool(await connect(stub), "get_traffic", { task: SLUG, hours: 48 });
    expect(answer.structured).toEqual({
      buckets: fx.trafficBuckets,
      deferralShare: 25 / 150,
      totals: { total: 150, served_student: 125, deferred: 25, model_mismatch: 1 },
    });
  });

  test("get_traffic refuses hours outside 1 to 720 without calling the API", async () => {
    const stub = stubRoutes({});
    const client = await connect(stub);
    const result = await client.callTool({ name: "get_traffic", arguments: { task: SLUG, hours: 1000 } });
    expect(result.isError).toBe(true);
    expect(stub.requests).toHaveLength(0);
  });

  test("list_canaries and list_alerts return newest first up to limit", async () => {
    const stub = stubRoutes({
      [`GET /v1/tasks/${SLUG}/canaries`]: { status: 200, body: { runs: [fx.canary, fx.canary] } },
      [`GET /v1/tasks/${SLUG}/alerts`]: { status: 200, body: { alerts: [fx.alert] } },
    });
    const client = await connect(stub);
    expect((await callTool(client, "list_canaries", { task: SLUG, limit: 1 })).structured).toEqual({ runs: [fx.canary], total: 2 });
    expect((await callTool(client, "list_alerts", { task: SLUG })).structured).toEqual({ alerts: [fx.alert], total: 1 });
  });
});

describe("training tools", () => {
  test("list_train_runs returns the runs", async () => {
    const stub = stubRoutes({ [`GET /v1/tasks/${SLUG}/train-runs`]: { status: 200, body: { runs: [fx.trainRun] } } });
    const answer = await callTool(await connect(stub), "list_train_runs", { task: SLUG });
    expect(answer.structured).toEqual({ runs: [fx.trainRun], total: 1 });
  });

  test("get_train_run summarises every series: first, last and best", async () => {
    const stub = stubRoutes({ "GET /v1/train-runs/run-1": { status: 200, body: { run: fx.trainRun, series: fx.trainSeries } } });
    const answer = await callTool(await connect(stub), "get_train_run", { key: "run-1" });
    expect(answer.structured).toEqual({
      run: fx.trainRun,
      metrics: {
        eval_loss: {
          points: 3,
          first: { step: 100, value: 0.9 },
          last: { step: 300, value: 0.4 },
          best: { step: 200, value: 0.35 },
          better: "lower",
        },
        eval_reward: {
          points: 3,
          first: { step: 100, value: 0.2 },
          last: { step: 300, value: 0.55 },
          best: { step: 200, value: 0.6 },
          better: "higher",
        },
        learning_rate: {
          points: 1,
          first: { step: 100, value: 0.0002 },
          last: { step: 100, value: 0.0002 },
          best: null,
          better: null,
        },
      },
    });
  });

  test("get_train_run on an unknown key points at list_train_runs", async () => {
    const answer = await callTool(await connect(stubRoutes({})), "get_train_run", { key: "missing" });
    expect(answer.isError).toBe(true);
    expect(String(answer.body.next_step)).toContain("list_train_runs");
  });
});

describe("failures", () => {
  test("a 429 the retries could not absorb is retryable with retry_after", async () => {
    const stub = stubRoutes({ "GET /v1/tasks": { status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "2" } } });
    const answer = await callTool(await connect(stub), "list_tasks");
    expect(stub.requests).toHaveLength(3);
    expect(answer.body).toMatchObject({ error: "rate_limited", retryable: true, retry_after: 2 });
  });

  test("a 401 from the API says to reconnect", async () => {
    const stub = stubRoutes({ "GET /v1/tasks": { status: 401, body: { error: "unauthorized" } } });
    const answer = await callTool(await connect(stub), "list_tasks");
    expect(answer.body).toMatchObject({ error: "unauthorized", retryable: false });
  });
});
