import { describe, expect, test } from "bun:test";
import { createClickHouseTraffic, TRAFFIC_SETTINGS } from "../src/traffic-clickhouse.ts";

type Captured = { url: URL; init: RequestInit };

function stubFetch(body: unknown, status = 200) {
  const calls: Captured[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { calls, fetcher };
}

const clickhouseRows = {
  data: [
    {
      hour: "2026-11-23T00:00:00Z",
      total: "100",
      served_student: "70",
      deferred: "30",
      model_mismatch: "1",
      p95_student_ms: 120.5,
      p95_cloud_ms: null,
    },
    {
      hour: "2026-11-23T01:00:00Z",
      total: 4,
      served_student: 4,
      deferred: 0,
      model_mismatch: 0,
      p95_student_ms: "nan",
      p95_cloud_ms: 800,
    },
  ],
};

describe("ClickHouse traffic", () => {
  test("maps hourly rows into numeric buckets", async () => {
    const { fetcher } = stubFetch(clickhouseRows);
    const traffic = createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher });
    expect(await traffic.hourly("technographics", 24)).toEqual([
      {
        hour: "2026-11-23T00:00:00Z",
        total: 100,
        served_student: 70,
        deferred: 30,
        model_mismatch: 1,
        p95_student_ms: 120.5,
        p95_cloud_ms: null,
      },
      {
        hour: "2026-11-23T01:00:00Z",
        total: 4,
        served_student: 4,
        deferred: 0,
        model_mismatch: 0,
        p95_student_ms: null,
        p95_cloud_ms: 800,
      },
    ]);
  });

  test("passes the task and window as query parameters, never in the SQL", async () => {
    const { calls, fetcher } = stubFetch({ data: [] });
    const traffic = createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher });
    await traffic.hourly("x'; DROP TABLE t; --", 6);
    const [call] = calls;
    const sql = String(call!.init.body);
    expect(call!.url.searchParams.get("param_task")).toBe("x'; DROP TABLE t; --");
    expect(call!.url.searchParams.get("param_hours")).toBe("6");
    expect(sql).not.toContain("DROP");
    expect(sql).toContain("{task:String}");
    expect(sql).toContain("{hours:UInt32}");
    expect(sql).toContain("modelstill.serving_events");
  });

  test("every read carries explicit execution limits", async () => {
    const { calls, fetcher } = stubFetch({ data: [] });
    await createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher }).hourly("t", 1);
    const sql = String(calls[0]!.init.body);
    expect(sql).toMatch(/SETTINGS .*max_execution_time = \d+/);
    expect(sql).toMatch(/max_threads = \d+/);
    expect(sql).toMatch(/max_memory_usage = \d+/);
    expect(TRAFFIC_SETTINGS.max_threads).toBeGreaterThan(0);
  });

  test("sends credentials as headers when given", async () => {
    const { calls, fetcher } = stubFetch({ data: [] });
    await createClickHouseTraffic({
      url: "http://clickhouse:8123",
      user: "reader",
      password: "secret",
      fetch: fetcher,
    }).hourly("t", 1);
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("x-clickhouse-user")).toBe("reader");
    expect(headers.get("x-clickhouse-key")).toBe("secret");
  });

  test("a failed query raises with ClickHouse's message", async () => {
    const { fetcher } = stubFetch("Code: 159. TIMEOUT_EXCEEDED", 500);
    const traffic = createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher });
    await expect(traffic.hourly("t", 1)).rejects.toThrow(/TIMEOUT_EXCEEDED/);
  });
});

const requestRows = {
  data: [
    {
      ts_ms: "1763892000123",
      task: "capitals",
      deployment_id: "dep-1",
      request_hash: "aaaa000000000002",
      mode: "serve",
      served_from: "cloud",
      deferred: true,
      reason: "low_confidence",
      confidence: 0.4,
      student_model: "capitals-v2",
      model_match: true,
      student_output: "Lyon",
      cloud_model: "cloud-large",
      cloud_output: "Paris",
      student_ms: 80,
      cloud_ms: "700.5",
      student_cost_usd: null,
      cloud_cost_usd: 0.0011,
    },
  ],
};

describe("ClickHouse request log", () => {
  const window = { from: "2026-11-20T00:00:00.000Z", to: "2026-11-21T00:00:00.000Z" };

  test("maps rows into served requests", async () => {
    const { fetcher } = stubFetch(requestRows);
    const log = createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher });
    expect(await log.requests({ task: "capitals", deferred: null, ...window, cursor: null, limit: 51 })).toEqual([
      {
        ts: new Date(1763892000123).toISOString(),
        task: "capitals",
        deploymentId: "dep-1",
        requestHash: "aaaa000000000002",
        mode: "serve",
        servedFrom: "cloud",
        deferred: true,
        reason: "low_confidence",
        confidence: 0.4,
        studentModel: "capitals-v2",
        modelMatch: true,
        studentOutput: "Lyon",
        cloudModel: "cloud-large",
        cloudOutput: "Paris",
        studentMs: 80,
        cloudMs: 700.5,
        studentCostUsd: null,
        cloudCostUsd: 0.0011,
      },
    ]);
  });

  test("sends every filter as a query parameter with execution limits", async () => {
    const { calls, fetcher } = stubFetch({ data: [] });
    const log = createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher });
    await log.requests({ task: "x' OR 1=1", deferred: true, ...window, cursor: { ts: 1763892000123, requestHash: "abc" }, limit: 26 });
    const [call] = calls;
    const params = call!.url.searchParams;
    expect(params.get("param_task")).toBe("x' OR 1=1");
    expect(params.get("param_deferred")).toBe("1");
    expect(params.get("param_from_ms")).toBe(String(Date.parse(window.from)));
    expect(params.get("param_to_ms")).toBe(String(Date.parse(window.to)));
    expect(params.get("param_cursor_ms")).toBe("1763892000123");
    expect(params.get("param_cursor_hash")).toBe("abc");
    expect(params.get("param_limit")).toBe("26");
    const sql = String(call!.init.body);
    expect(sql).not.toContain("OR 1=1");
    expect(sql).toContain("modelstill.serving_events");
    expect(sql).toMatch(/ORDER BY e\.ts DESC, e\.request_hash DESC/);
    expect(sql).toMatch(/SETTINGS .*max_execution_time = \d+/);
  });

  test("an empty task and no deferral filter mean every task and both kinds", async () => {
    const { calls, fetcher } = stubFetch({ data: [] });
    await createClickHouseTraffic({ url: "http://clickhouse:8123", fetch: fetcher }).requests({ task: null, deferred: null, ...window, cursor: null, limit: 5 });
    const params = calls[0]!.url.searchParams;
    expect(params.get("param_task")).toBe("");
    expect(params.get("param_deferred")).toBe("-1");
    expect(params.get("param_cursor_ms")).toBe("0");
  });

  test("reads another database when one is configured", async () => {
    const { calls, fetcher } = stubFetch({ data: [] });
    const log = createClickHouseTraffic({ url: "http://clickhouse:8123", database: "staging_ms", fetch: fetcher });
    await log.requests({ task: null, deferred: null, ...window, cursor: null, limit: 5 });
    await log.hourly("t", 1);
    expect(String(calls[0]!.init.body)).toContain("staging_ms.serving_events");
    expect(String(calls[1]!.init.body)).toContain("staging_ms.serving_events");
    expect(() => createClickHouseTraffic({ url: "http://clickhouse:8123", database: "bad; name" })).toThrow();
  });
});
