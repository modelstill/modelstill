import { describe, expect, test } from "bun:test";
import { ApiError, ApiUnreachableError, createApiClient } from "../src/lib/api";

type Call = { url: string; init?: RequestInit };

function stubFetch(routes: Record<string, unknown>, status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname + new URL(url).search;
    if (!(path in routes)) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const BASE = "http://api.test";

const task = {
  slug: "job-title-normalize",
  version: "3",
  snapshotHash: "sha256:abc",
  mode: "shadow",
  deferralShare: 0.12,
  lastGatePassed: true,
};

describe("api client parses every response shape", () => {
  test("tasks", async () => {
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks": { tasks: [task, { ...task, slug: "b", deferralShare: null, lastGatePassed: null, mode: "off" }] } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const tasks = await api.listTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.mode).toBe("shadow");
    expect(tasks[1]!.deferralShare).toBeNull();
    expect(calls[0]!.url).toBe("http://api.test/v1/tasks");
  });

  test("a task", async () => {
    const { fetchImpl } = stubFetch({ "/v1/tasks/job-title-normalize": { task } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    expect((await api.getTask("job-title-normalize")).snapshotHash).toBe("sha256:abc");
  });

  test("a slug is url-encoded", async () => {
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks/a%20b": { task } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    await api.getTask("a b");
    expect(calls[0]!.url).toBe("http://api.test/v1/tasks/a%20b");
  });

  test("versions", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/versions": {
        versions: [{ id: "v1", version: "1", snapshotHash: "h", gitSha: "deadbeef", createdAt: "2026-11-20T10:00:00Z" }],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    expect((await api.listVersions("t"))[0]!.gitSha).toBe("deadbeef");
  });

  test("gates", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/gates": {
        gates: [
          {
            id: "g1",
            taskSlug: "t",
            createdAt: "2026-11-20T10:00:00Z",
            passed: false,
            checks: [{ name: "quality_lower_bound", threshold: 0.8, value: 0.78, passed: false }],
          },
        ],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const gates = await api.listGates("t");
    expect(gates[0]!.checks[0]!.value).toBe(0.78);
  });

  test("eval runs", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/eval-runs": {
        runs: [{ id: "r1", createdAt: "2026-11-20T10:00:00Z", model: "student-3", split: "test", judgeModel: "judge", mean: 0.83, low: 0.79, high: 0.86, cases: 300 }],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const [run] = await api.listEvalRuns("t");
    expect(run!.high).toBe(0.86);
    expect(run!.primaryMetric).toBeNull();
    expect(run!.metrics).toEqual({});
  });

  test("eval runs carry their named metrics and primary metric", async () => {
    const pooled = { value: 0.819, low: 0.78, high: 0.855 };
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/eval-runs": {
        runs: [
          {
            id: "r1",
            createdAt: "2026-11-23T13:27:48Z",
            model: "technographics",
            split: "gold",
            judgeModel: "",
            mean: 0.819,
            low: 0.78,
            high: 0.855,
            cases: 307,
            metrics: { pooled_f1: pooled },
            primaryMetric: "pooled_f1",
            benchmark: { name: "tech_gold", version: "d9c454a2" },
          },
        ],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const [run] = await api.listEvalRuns("t");
    expect(run!.primaryMetric).toBe("pooled_f1");
    expect(run!.metrics["pooled_f1"]).toEqual(pooled);
    expect(run!.benchmark).toEqual({ name: "tech_gold", version: "d9c454a2" });
  });

  test("compare", async () => {
    const { fetchImpl, calls } = stubFetch({
      "/v1/eval-runs/compare?before=r1&after=r2": {
        before: "r1",
        after: "r2",
        difference: 0.03,
        low: -0.01,
        high: 0.07,
        verdict: "no_detectable_difference",
        fixed: 4,
        broken: 2,
        cases: [{ inputHash: "a", before: 1, after: 0 }],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const result = await api.compareEvalRuns("r1", "r2");
    expect(result.verdict).toBe("no_detectable_difference");
    expect(result.cases[0]!.after).toBe(0);
    expect(calls[0]!.url).toBe("http://api.test/v1/eval-runs/compare?before=r1&after=r2");
  });

  test("review queue", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/review-queue": {
        items: [{ id: "i1", inputHash: "h", input: { title: "sr eng" }, teacherOutputs: { "teacher-a": { title: "Senior Engineer" } }, agreement: 0.5, reviewState: "pending" }],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const items = await api.listReviewQueue("t");
    expect(items[0]!.teacherOutputs).toEqual([{ teacher: "teacher-a", output: { title: "Senior Engineer" } }]);
  });

  test("review queue with teacher outputs as a list", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/review-queue": {
        items: [{ id: "i1", inputHash: "h", input: "x", teacherOutputs: [{ teacher: "a", output: 1 }, { model: "b", output: 2 }], agreement: null, reviewState: "pending" }],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const items = await api.listReviewQueue("t");
    expect(items[0]!.teacherOutputs).toEqual([
      { teacher: "a", output: 1 },
      { teacher: "b", output: 2 },
    ]);
  });

  test("review queue with agreement as a boolean, as the API stores it", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/review-queue": {
        items: [
          { id: "i1", inputHash: "h", input: "x", teacherOutputs: { a: ["spark"] }, agreement: false, reviewState: "queued" },
          { id: "i2", inputHash: "h2", input: "x", teacherOutputs: { a: ["spark"] }, agreement: true, reviewState: "queued" },
        ],
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const items = await api.listReviewQueue("t");
    expect(items.map((item) => item.agreement)).toEqual([0, 1]);
  });

  test("decision posts json and returns the item", async () => {
    const item = { id: "i1", inputHash: "h", input: "x", teacherOutputs: {}, agreement: 1, reviewState: "accepted" };
    const { fetchImpl, calls } = stubFetch({ "/v1/review-queue/i1/decision": { item } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const result = await api.decideReviewItem("i1", { verdict: "accept", reviewer: "dana" });
    expect(result.reviewState).toBe("accepted");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ verdict: "accept", reviewer: "dana" });
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/json");
  });

  test("the review queue can ask for a larger page", async () => {
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks/t/review-queue?limit=500": { items: [] } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    expect(await api.listReviewQueue("t", 500)).toEqual([]);
    expect(calls[0]!.url).toBe("http://api.test/v1/tasks/t/review-queue?limit=500");
  });

  test("a bulk accept posts every id and returns the decided items and the missing ids", async () => {
    const item = { id: "i1", inputHash: "h", input: "x", teacherOutputs: { a: 1 }, agreement: false, reviewState: "accepted" };
    const { fetchImpl, calls } = stubFetch({ "/v1/review-queue/decisions": { items: [item], missing: ["i2"] } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const result = await api.acceptReviewItems(["i1", "i2"], "dana");
    expect(result.items.map((entry) => entry.reviewState)).toEqual(["accepted"]);
    expect(result.missing).toEqual(["i2"]);
    expect(calls[0]!.url).toBe("http://api.test/v1/review-queue/decisions");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ itemIds: ["i1", "i2"], verdict: "accept", reviewer: "dana" });
  });

  test("dataset items carry the final output and filter by state", async () => {
    const item = { id: "i1", inputHash: "h", input: "x", teacherOutputs: { a: 1 }, agreement: false, reviewState: "corrected", finalOutput: { title: "Staff Engineer" } };
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks/t/dataset-items?state=corrected": { items: [item] }, "/v1/tasks/t/dataset-items": { items: [item] } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const items = await api.listDatasetItems("t", "corrected");
    expect(items[0]!.finalOutput).toEqual({ title: "Staff Engineer" });
    expect(items[0]!.agreement).toBe(0);
    expect(calls[0]!.url).toBe("http://api.test/v1/tasks/t/dataset-items?state=corrected");
    await api.listDatasetItems("t");
    expect(calls[1]!.url).toBe("http://api.test/v1/tasks/t/dataset-items");
  });

  test("sending cases to review queues them with both answers", async () => {
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks/t/review-items": { upserted: 1 } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const upserted = await api.sendToReview("t", [{ inputHash: "h1", input: { q: 1 }, outputs: { "before gpt": "a", "after student": "b" } }]);
    expect(upserted).toBe(1);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      items: [{ inputHash: "h1", input: { q: 1 }, teacherOutputs: { "before gpt": "a", "after student": "b" }, agreement: false, reviewState: "queued" }],
    });
  });

  test("deployment, present and absent", async () => {
    const deployment = { mode: "serve", studentModel: "student-3", threshold: 0.91, targetError: 0.02, shadowSample: 0.1, activeFrom: "2026-11-20T10:00:00Z" };
    const present = createApiClient({ baseUrl: BASE, fetchImpl: stubFetch({ "/v1/tasks/t/deployment": { deployment } }).fetchImpl });
    expect((await present.getDeployment("t"))?.threshold).toBe(0.91);
    const absent = createApiClient({ baseUrl: BASE, fetchImpl: stubFetch({ "/v1/tasks/t/deployment": { deployment: null } }).fetchImpl });
    expect(await absent.getDeployment("t")).toBeNull();
  });

  test("setting the deployment puts the whole record and returns the stored one", async () => {
    const stored = { mode: "serve", studentModel: "student-3", threshold: 0.91, targetError: 0.02, shadowSample: 0.1, activeFrom: "2026-11-25T10:00:00Z" };
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks/t/deployment": { deployment: stored } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const update = { mode: "serve" as const, studentModel: "student-3", threshold: 0.91, targetError: 0.02, shadowSample: 0.1, activeFrom: null };
    expect((await api.setDeployment("t", update)).mode).toBe("serve");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(update);
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/json");
  });

  test("traffic", async () => {
    const { fetchImpl, calls } = stubFetch({
      "/v1/tasks/t/traffic?hours=24": {
        buckets: [{ hour: "2026-11-20T10:00:00Z", total: 10, served_student: 8, deferred: 2, model_mismatch: 0, p95_student_ms: 120, p95_cloud_ms: null }],
        deferralShare: 0.2,
      },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const traffic = await api.getTraffic("t", 24);
    expect(traffic.buckets[0]!.served_student).toBe(8);
    expect(traffic.deferralShare).toBe(0.2);
    expect(calls[0]!.url).toBe("http://api.test/v1/tasks/t/traffic?hours=24");
  });

  test("canaries", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/canaries": { runs: [{ createdAt: "2026-11-20T10:00:00Z", provider: "openai", passed: 19, total: 20, low: 0.75, high: 0.99 }] },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    expect((await api.listCanaries("t"))[0]!.total).toBe(20);
  });

  test("alerts", async () => {
    const { fetchImpl } = stubFetch({
      "/v1/tasks/t/alerts": { alerts: [{ id: "a1", kind: "drift", severity: "warning", createdAt: "2026-11-20T10:00:00Z", ackedAt: null, payload: { psi: 0.3 } }] },
    });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    expect((await api.listAlerts("t"))[0]!.payload).toEqual({ psi: 0.3 });
  });
});

describe("train runs", () => {
  const run = {
    key: "t-9256c08a-a41fcbab-s1",
    taskSlug: "t",
    base: "Qwen/Qwen3-4B",
    method: "lora",
    status: "running",
    manifest: { snapshot: "9256c08a" },
    attestation: null,
    finalMetrics: null,
    startedAt: "2026-11-24T08:00:00.000Z",
    finishedAt: null,
  };

  test("a task's train runs", async () => {
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks/t/train-runs": { runs: [run, { ...run, key: "b", status: "succeeded", finalMetrics: { eval_loss: 0.4 } }] } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const runs = await api.listTrainRuns("t");
    expect(runs.map((entry) => entry.status)).toEqual(["running", "succeeded"]);
    expect(runs[1]!.finalMetrics).toEqual({ eval_loss: 0.4 });
    expect(calls[0]!.url).toBe("http://api.test/v1/tasks/t/train-runs");
  });

  test("one train run with its series, key url-encoded", async () => {
    const series = { loss: [{ step: 10, epoch: 0.1, value: 1.4 }], eval_loss: [{ step: 20, epoch: null, value: 0.9 }] };
    const { fetchImpl, calls } = stubFetch({ "/v1/train-runs/a%20b": { run, series } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const detail = await api.getTrainRun("a b");
    expect(detail.run.base).toBe("Qwen/Qwen3-4B");
    expect(detail.series["eval_loss"]![0]!.epoch).toBeNull();
    expect(calls[0]!.url).toBe("http://api.test/v1/train-runs/a%20b");
  });

  test("an unknown status is a parse error", async () => {
    const { fetchImpl } = stubFetch({ "/v1/tasks/t/train-runs": { runs: [{ ...run, status: "queued" }] } });
    const error = await createApiClient({ baseUrl: BASE, fetchImpl }).listTrainRuns("t").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe("api client errors", () => {
  test("surfaces an HTTP error with status and url", async () => {
    const { fetchImpl } = stubFetch({ "/v1/tasks": { error: "boom" } }, 500);
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const error = await api.listTasks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toContain("500");
    expect((error as ApiError).message).toContain("http://api.test/v1/tasks");
  });

  test("surfaces a 404 as an ApiError", async () => {
    const { fetchImpl } = stubFetch({});
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const error = await api.getTask("missing").catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(404);
  });

  test("a network failure says the API is unreachable at the base url", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const error = await api.listTasks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnreachableError);
    expect((error as Error).message).toBe("API unreachable at http://api.test");
  });

  test("a response of the wrong shape is an error, not undefined data", async () => {
    const { fetchImpl } = stubFetch({ "/v1/tasks": { tasks: [{ slug: 1 }] } });
    const api = createApiClient({ baseUrl: BASE, fetchImpl });
    const error = await api.listTasks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as Error).message).toContain("unexpected response");
  });

  test("defaults the base url to localhost:8787 and strips a trailing slash", async () => {
    const { fetchImpl, calls } = stubFetch({ "/v1/tasks": { tasks: [] } });
    await createApiClient({ fetchImpl }).listTasks();
    expect(calls[0]!.url).toBe("http://localhost:8787/v1/tasks");
    await createApiClient({ baseUrl: "http://x.test/", fetchImpl }).listTasks();
    expect(calls[1]!.url).toBe("http://x.test/v1/tasks");
  });
});
