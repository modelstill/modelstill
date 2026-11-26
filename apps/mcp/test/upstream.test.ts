import { describe, expect, test } from "bun:test";
import { UpstreamError, createApi } from "../src/upstream.ts";
import { instantTiming, stubFetch, stubRoutes } from "./stub.ts";

const BASE = "http://api.test";

function apiWith(stub: { fetch: typeof fetch }, timing = instantTiming().timing) {
  return createApi({ baseUrl: `${BASE}/`, credential: "ms_live_abc", fetch: stub.fetch, timing });
}

describe("upstream", () => {
  test("forwards the caller's credential as a bearer and parses the JSON body", async () => {
    const stub = stubRoutes({ "GET /v1/tasks": { status: 200, body: { tasks: [] } } });
    const result = await apiWith(stub).listTasks();
    expect(result).toEqual({ tasks: [] });
    expect(stub.requests[0]?.url).toBe(`${BASE}/v1/tasks`);
    expect(stub.requests[0]?.authorization).toBe("Bearer ms_live_abc");
  });

  test("encodes path segments and query parameters", async () => {
    const stub = stubFetch(() => ({ status: 200, body: {} }));
    const api = apiWith(stub);
    await api.getTask("a b/c");
    await api.compareRuns("r1", "r 2");
    await api.reviewQueue("t", 20);
    await api.traffic("t", 48);
    expect(stub.requests.map((r) => r.path)).toEqual([
      "/v1/tasks/a%20b%2Fc",
      "/v1/eval-runs/compare?before=r1&after=r+2",
      "/v1/tasks/t/review-queue?limit=20",
      "/v1/tasks/t/traffic?hours=48",
    ]);
  });

  test("calls every read endpoint at its path", async () => {
    const stub = stubFetch(() => ({ status: 200, body: {} }));
    const api = apiWith(stub);
    await api.listVersions("t");
    await api.listGates("t");
    await api.listEvalRuns("t");
    await api.getDeployment("t");
    await api.listCanaries("t");
    await api.listAlerts("t");
    await api.listTrainRuns("t");
    await api.getTrainRun("run.1");
    expect(stub.requests.map((r) => r.path)).toEqual([
      "/v1/tasks/t/versions",
      "/v1/tasks/t/gates",
      "/v1/tasks/t/eval-runs",
      "/v1/tasks/t/deployment",
      "/v1/tasks/t/canaries",
      "/v1/tasks/t/alerts",
      "/v1/tasks/t/train-runs",
      "/v1/train-runs/run.1",
    ]);
  });

  test("writes send a JSON body with the right method", async () => {
    const stub = stubFetch(() => ({ status: 200, body: {} }));
    const api = apiWith(stub);
    await api.decideReview("item-1", { verdict: "accept", reviewer: "me" });
    await api.setDeployment("t", { mode: "off" });
    expect(stub.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/v1/review-queue/item-1/decision", { verdict: "accept", reviewer: "me" }],
      ["PUT", "/v1/tasks/t/deployment", { mode: "off" }],
    ]);
  });

  test("a non-2xx answer becomes an UpstreamError with the API's code and issues", async () => {
    const stub = stubFetch(() => ({
      status: 400,
      body: { error: "invalid_request", issues: [{ message: "bad", path: ["limit"] }] },
    }));
    const error = await apiWith(stub).reviewQueue("t", 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    const upstream = error as UpstreamError;
    expect(upstream.status).toBe(400);
    expect(upstream.code).toBe("invalid_request");
    expect(upstream.issues).toEqual([{ message: "bad", path: ["limit"] }]);
  });

  test("a read answered 429 is retried, waiting Retry-After capped at 2 s", async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls += 1;
      return calls < 3
        ? { status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "5" } }
        : { status: 200, body: { tasks: [] } };
    });
    const { timing, waits } = instantTiming();
    expect(await apiWith(stub, timing).listTasks()).toEqual({ tasks: [] });
    expect(stub.requests).toHaveLength(3);
    expect(waits).toEqual([2000, 2000]);
  });

  test("a read gives up after 3 attempts and reports retry_after", async () => {
    const stub = stubFetch(() => ({ status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "1" } }));
    const error = (await apiWith(stub).listTasks().catch((e: unknown) => e)) as UpstreamError;
    expect(stub.requests).toHaveLength(3);
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(1);
  });

  test("a read never waits past 8 s in total", async () => {
    const stub = stubFetch(() => ({ status: 429, body: { error: "rate_limited" } }));
    const { timing } = instantTiming();
    const slowTiming = { now: timing.now, sleep: async (ms: number) => timing.sleep(ms * 5) };
    await apiWith(stub, slowTiming).listTasks().catch(() => undefined);
    expect(stub.requests).toHaveLength(2);
  });

  test("a write answered 429 is never sent twice", async () => {
    const stub = stubFetch(() => ({ status: 429, body: { error: "rate_limited" } }));
    const error = (await apiWith(stub).setDeployment("t", { mode: "off" }).catch((e: unknown) => e)) as UpstreamError;
    expect(stub.requests).toHaveLength(1);
    expect(error.status).toBe(429);
  });

  test("a network failure becomes a 502 upstream_unreachable", async () => {
    const failing = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    const error = (await apiWith({ fetch: failing }).listTasks().catch((e: unknown) => e)) as UpstreamError;
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("upstream_unreachable");
  });
});
