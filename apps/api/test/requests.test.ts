import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import type { RequestLog, RequestQuery, ServedRequest } from "../src/requests.ts";
import { createMemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";

function served(overrides: Partial<ServedRequest> = {}): ServedRequest {
  return {
    ts: "2026-11-23T10:00:00.000Z",
    task: "capitals",
    deploymentId: "dep-1",
    requestHash: "aaaa000000000001",
    mode: "serve",
    servedFrom: "student",
    deferred: false,
    reason: null,
    confidence: 0.93,
    studentModel: "capitals-v2",
    modelMatch: true,
    studentOutput: "Paris",
    cloudModel: null,
    cloudOutput: null,
    studentMs: 80,
    cloudMs: null,
    studentCostUsd: 0.00002,
    cloudCostUsd: null,
    ...overrides,
  };
}

const deferred = served({
  ts: "2026-11-23T09:00:00.000Z",
  requestHash: "aaaa000000000002",
  servedFrom: "cloud",
  deferred: true,
  reason: "low_confidence",
  confidence: 0.4,
  studentOutput: "Lyon",
  cloudModel: "cloud-large",
  cloudOutput: "Paris",
  cloudMs: 700,
  cloudCostUsd: 0.0011,
});

let queries: RequestQuery[];
let rows: ServedRequest[];
let app: ReturnType<typeof createApp>;

function stubLog(): RequestLog {
  return {
    requests: async (query) => {
      queries.push(query);
      return rows.slice(0, query.limit);
    },
  };
}

beforeEach(() => {
  queries = [];
  rows = [served(), deferred];
  app = createApp({ store: createMemoryStore(), requests: stubLog(), apiToken: TOKEN });
});

async function get(path: string, token: string | null = TOKEN) {
  const response = await app.request(path, token === null ? {} : { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as ReturnType<typeof JSON.parse> };
}

describe("GET /v1/requests", () => {
  test("lists individual requests with who answered, latency, cost and deferral", async () => {
    const { status, body } = await get("/v1/requests?task=capitals");
    expect(status).toBe(200);
    expect(body.requestBodyStored).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.requests[0]).toMatchObject({
      id: `${Date.parse("2026-11-23T10:00:00.000Z")}:aaaa000000000001`,
      task: "capitals",
      answeredBy: "capitals-v2",
      latencyMs: 80,
      costUsd: 0.00002,
      deferred: false,
      studentOutput: "Paris",
    });
    expect(body.requests[1]).toMatchObject({ answeredBy: "cloud-large", latencyMs: 780, deferred: true, reason: "low_confidence" });
    expect(body.requests[1].costUsd).toBeCloseTo(0.00112, 10);
  });

  test("passes the filters to the log and defaults the window to the last seven days", async () => {
    await get("/v1/requests?task=capitals&deferred=true&from=2026-11-20T00:00:00Z&to=2026-11-21T00:00:00Z&limit=10");
    expect(queries[0]).toEqual({
      task: "capitals",
      deferred: true,
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-21T00:00:00.000Z",
      cursor: null,
      limit: 11,
    });
    await get("/v1/requests");
    const query = queries[1]!;
    expect(query.task).toBeNull();
    expect(query.deferred).toBeNull();
    expect(Date.parse(query.to) - Date.parse(query.from)).toBe(7 * 24 * 3600 * 1000);
    expect(query.limit).toBe(51);
  });

  test("pages with an opaque cursor taken from the last row shown", async () => {
    rows = [served(), deferred, served({ ts: "2026-11-23T08:00:00.000Z", requestHash: "aaaa000000000003" })];
    const first = await get("/v1/requests?limit=2");
    expect(first.body.requests).toHaveLength(2);
    expect(typeof first.body.nextCursor).toBe("string");
    await get(`/v1/requests?limit=2&cursor=${first.body.nextCursor}`);
    expect(queries[1]!.cursor).toEqual({ ts: Date.parse("2026-11-23T09:00:00.000Z"), requestHash: "aaaa000000000002" });
  });

  test("rejects a bad cursor, an inverted window and an oversized page", async () => {
    expect((await get("/v1/requests?cursor=not-a-cursor")).status).toBe(400);
    expect((await get("/v1/requests?from=2026-11-21T00:00:00Z&to=2026-11-20T00:00:00Z")).status).toBe(400);
    expect((await get("/v1/requests?limit=1000")).status).toBe(400);
    expect((await get("/v1/requests?deferred=maybe")).status).toBe(400);
  });

  test("needs a credential and is empty without a request log", async () => {
    expect((await get("/v1/requests", null)).status).toBe(401);
    app = createApp({ store: createMemoryStore(), apiToken: TOKEN });
    expect((await get("/v1/requests")).body).toEqual({ requests: [], nextCursor: null, requestBodyStored: false });
  });

  test("is in the OpenAPI document", async () => {
    expect(Object.keys((await get("/openapi.json")).body.paths)).toContain("/v1/requests");
  });
});
