import type { RequestLog, RequestQuery, ServedRequest } from "./requests.ts";
import type { TrafficBucket, TrafficStore } from "./traffic.ts";

export const TRAFFIC_SETTINGS = {
  max_execution_time: 10,
  max_threads: 2,
  max_memory_usage: 1_000_000_000,
} as const;

const settingsClause = Object.entries(TRAFFIC_SETTINGS)
  .map(([name, value]) => `${name} = ${value}`)
  .join(", ");

export const DEFAULT_CLICKHOUSE_DATABASE = "modelstill";

const DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function hourlyTrafficSql(database = DEFAULT_CLICKHOUSE_DATABASE): string {
  return `
SELECT
  formatDateTime(toStartOfHour(e.ts), '%Y-%m-%dT%H:00:00Z') AS hour,
  count() AS total,
  countIf(e.served_from = 'student') AS served_student,
  countIf(e.deferred) AS deferred,
  countIf(e.model_match = false) AS model_mismatch,
  quantile(0.95)(e.student_ms) AS p95_student_ms,
  quantile(0.95)(e.cloud_ms) AS p95_cloud_ms
FROM ${database}.serving_events AS e
WHERE e.task = {task:String}
  AND e.ts >= now64(3) - toIntervalHour({hours:UInt32})
GROUP BY hour
ORDER BY hour
SETTINGS ${settingsClause}
FORMAT JSON`;
}

export const HOURLY_TRAFFIC_SQL = hourlyTrafficSql();

export function requestsSql(database = DEFAULT_CLICKHOUSE_DATABASE): string {
  return `
SELECT
  toUnixTimestamp64Milli(e.ts) AS ts_ms,
  e.task AS task,
  e.deployment_id AS deployment_id,
  e.request_hash AS request_hash,
  e.mode AS mode,
  e.served_from AS served_from,
  e.deferred AS deferred,
  e.reason AS reason,
  e.confidence AS confidence,
  e.student_model AS student_model,
  e.model_match AS model_match,
  e.student_output AS student_output,
  e.cloud_model AS cloud_model,
  e.cloud_output AS cloud_output,
  e.student_ms AS student_ms,
  e.cloud_ms AS cloud_ms,
  e.student_cost_usd AS student_cost_usd,
  e.cloud_cost_usd AS cloud_cost_usd
FROM ${database}.serving_events AS e
WHERE ({task:String} = '' OR e.task = {task:String})
  AND ({deferred:Int8} = -1 OR e.deferred = ({deferred:Int8} = 1))
  AND e.ts >= fromUnixTimestamp64Milli({from_ms:Int64}, 'UTC')
  AND e.ts < fromUnixTimestamp64Milli({to_ms:Int64}, 'UTC')
  AND ({cursor_ms:Int64} = 0 OR (e.ts, e.request_hash) < (fromUnixTimestamp64Milli({cursor_ms:Int64}, 'UTC'), {cursor_hash:String}))
ORDER BY e.ts DESC, e.request_hash DESC
LIMIT {limit:UInt32}
SETTINGS ${settingsClause}
FORMAT JSON`;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ClickHouseTrafficOptions = {
  url: string;
  user?: string;
  password?: string;
  database?: string;
  fetch?: Fetcher;
};

type Row = Record<keyof TrafficBucket, unknown>;

type RequestRow = Record<string, unknown>;

function count(value: unknown): number {
  return Number(value);
}

function latency(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function flag(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return value === true || value === 1 || value === "1" || value === "true";
}

function toBucket(row: Row): TrafficBucket {
  return {
    hour: String(row.hour),
    total: count(row.total),
    served_student: count(row.served_student),
    deferred: count(row.deferred),
    model_mismatch: count(row.model_mismatch),
    p95_student_ms: latency(row.p95_student_ms),
    p95_cloud_ms: latency(row.p95_cloud_ms),
  };
}

function toRequest(row: RequestRow): ServedRequest {
  return {
    ts: new Date(Number(row["ts_ms"])).toISOString(),
    task: String(row["task"]),
    deploymentId: String(row["deployment_id"] ?? ""),
    requestHash: String(row["request_hash"]),
    mode: String(row["mode"] ?? ""),
    servedFrom: String(row["served_from"] ?? ""),
    deferred: flag(row["deferred"]) ?? false,
    reason: text(row["reason"]),
    confidence: latency(row["confidence"]),
    studentModel: text(row["student_model"]),
    modelMatch: flag(row["model_match"]),
    studentOutput: text(row["student_output"]),
    cloudModel: text(row["cloud_model"]),
    cloudOutput: text(row["cloud_output"]),
    studentMs: latency(row["student_ms"]),
    cloudMs: latency(row["cloud_ms"]),
    studentCostUsd: latency(row["student_cost_usd"]),
    cloudCostUsd: latency(row["cloud_cost_usd"]),
  };
}

function requestParams(query: RequestQuery): Record<string, string> {
  return {
    task: query.task ?? "",
    deferred: query.deferred === null ? "-1" : query.deferred ? "1" : "0",
    from_ms: String(Date.parse(query.from)),
    to_ms: String(Date.parse(query.to)),
    cursor_ms: String(query.cursor?.ts ?? 0),
    cursor_hash: query.cursor?.requestHash ?? "",
    limit: String(query.limit),
  };
}

export function createClickHouseTraffic(options: ClickHouseTrafficOptions): TrafficStore & RequestLog {
  const database = options.database ?? DEFAULT_CLICKHOUSE_DATABASE;
  if (!DATABASE_PATTERN.test(database)) throw new Error(`not a ClickHouse database name: ${database}`);
  const fetcher = options.fetch ?? fetch;
  const headers: Record<string, string> = { "content-type": "text/plain" };
  if (options.user) headers["x-clickhouse-user"] = options.user;
  if (options.password) headers["x-clickhouse-key"] = options.password;
  const hourly = hourlyTrafficSql(database);
  const requests = requestsSql(database);

  async function select<T>(sql: string, params: Record<string, string>, what: string): Promise<T[]> {
    const url = new URL(options.url);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(`param_${name}`, value);
    const response = await fetcher(url, { method: "POST", headers, body: sql });
    if (!response.ok) throw new Error(`ClickHouse ${what} query failed: ${await response.text()}`);
    return ((await response.json()) as { data: T[] }).data;
  }

  return {
    hourly: async (slug, hours) => (await select<Row>(hourly, { task: slug, hours: String(hours) }, "traffic")).map(toBucket),
    requests: async (query) => (await select<RequestRow>(requests, requestParams(query), "request")).map(toRequest),
  };
}
