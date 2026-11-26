import { parseError, type ClickHouseClient } from "@clickhouse/client";
import { logger } from "@modelstill/logger";

const EXCEPTION_LINE = /^(Code|Error): \d+\..*Exception: /m;
const EXCEPTION_START = /^(Code|Error): \d+\..*Exception: /;
const guardedClients = new WeakSet<object>();
type Body = Record<string, () => Promise<unknown>>;

function exceptionOf(row: unknown): string | null {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return null;
  const keys = Object.keys(row);
  if (keys.length !== 1 || keys[0] !== "exception") return null;
  const exception = (row as { exception: unknown }).exception;
  return typeof exception === "string" && EXCEPTION_START.test(exception) ? exception : null;
}

export function guardIncompleteResults(ch: ClickHouseClient): ClickHouseClient {
  if (guardedClients.has(ch)) return ch;
  const guarded = {
    query: async (params: unknown) => {
      const result = (await ch.query(params as never)) as object;
      return new Proxy(result, {
        get(target, prop, receiver) {
          if (prop === "json") {
            return async () => {
              const rows = await (target as Body).json();
              const exception = exceptionOf(Array.isArray(rows) ? rows.at(-1) : rows);
              if (exception !== null) throw parseError(exception);
              return rows;
            };
          }
          if (prop === "text") {
            return async () => {
              const text = (await (target as Body).text()) as string;
              const at = text.search(EXCEPTION_LINE);
              if (at >= 0) throw parseError(text.slice(at));
              return text;
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as ClickHouseClient;
  guardedClients.add(guarded);
  return guarded;
}

const TRANSPORT_CODES = /^(ECONNREFUSED|ECONNRESET|ECONNABORTED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EPIPE|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_SOCKET)$/;
const TRANSPORT_MESSAGES = /ECONNREFUSED|ECONNRESET|ECONNABORTED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EPIPE|socket hang up|premature close|aborted/i;

function isTransportFailure(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && TRANSPORT_CODES.test(code)) return true;
  return TRANSPORT_MESSAGES.test(String((error as Error)?.message ?? error));
}

const RESET_CODES = /^(ECONNRESET|EPIPE|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_SOCKET)$/;
const RESET_MESSAGES = /ECONNRESET|EPIPE|socket hang up|premature close/i;

export function isConnectionReset(error: unknown): boolean {
  if (error == null || clickhouseCode(error) !== null) return false;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") return RESET_CODES.test(code);
  return RESET_MESSAGES.test(String((error as Error)?.message ?? error));
}

export const REPLICA_UNUSABLE_CODES: ReadonlySet<number> = new Set([60, 81, 231, 232, 234, 246, 695, 696, 722]);

export function clickhouseCode(error: unknown): number | null {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  if (typeof code === "number") return code;
  const match = String((error as Error)?.message ?? error ?? "").match(/Code: (\d+)/);
  return match ? Number(match[1]) : null;
}

export function isReplicaUnusable(error: unknown): boolean {
  if (error == null) return false;
  const code = clickhouseCode(error);
  if (code !== null) return REPLICA_UNUSABLE_CODES.has(code);
  return isTransportFailure(error);
}

export const UNHEALTHY_COOLDOWN_MS = 30_000;

export interface FailoverOptions {
  order?: "preferred" | "round-robin";
  labels?: string[];
  now?: () => number;
  cooldownMs?: number;
}

export function splitHosts(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function failoverAcrossHosts(clients: ClickHouseClient[], options: FailoverOptions = {}): ClickHouseClient {
  const primary = clients[0];
  if (!primary) throw new Error("no ClickHouse host to query");
  if (clients.length === 1) return primary;
  const hosts = clients.map(guardIncompleteResults);
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? UNHEALTHY_COOLDOWN_MS;
  const labels = options.labels ?? clients.map((_, i) => String(i));
  const roundRobin = options.order === "round-robin";
  const unhealthyUntil: number[] = clients.map(() => 0);
  let next = 0;

  const shouldFailOver = (error: unknown, params: unknown): boolean => {
    if ((params as { abort_signal?: AbortSignal })?.abort_signal?.aborted) return false;
    return isReplicaUnusable(error);
  };

  type Phase = "query" | "body";
  type Failure = { index: number; error: unknown; phase: Phase };

  const markUnhealthy = ({ index, error, phase }: Failure) => {
    unhealthyUntil[index] = now() + cooldownMs;
    logger.warn("clickhouse host failed over", {
      host: labels[index],
      phase,
      code: clickhouseCode(error),
      error: String((error as Error)?.message ?? error).slice(0, 300),
      cooldown_ms: cooldownMs,
    });
  };

  const hostOrder = (): number[] => {
    const start = roundRobin ? next++ % clients.length : 0;
    const rotation = clients.map((_, i) => (start + i) % clients.length);
    const t = now();
    return [...rotation.filter((i) => (unhealthyUntil[i] ?? 0) <= t), ...rotation.filter((i) => (unhealthyUntil[i] ?? 0) > t)];
  };

  const guardBody = (result: object, retry: (error: unknown) => Promise<object>): object =>
    new Proxy(result, {
      get(target, prop, receiver) {
        if (prop === "json" || prop === "text") {
          return async () => {
            try {
              return await (target as Body)[prop]();
            } catch (error) {
              return ((await retry(error)) as Body)[prop]();
            }
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  const run = async (params: unknown, remaining: number[], unconfirmed: Failure[] = [], firstError?: unknown, retried = false): Promise<object> => {
    const [index, ...rest] = remaining;
    if (index === undefined) throw firstError;
    const failOver = (error: unknown, phase: Phase, pending: Failure[]): Promise<object> => {
      if (!shouldFailOver(error, params)) throw error;
      if (!retried && isConnectionReset(error)) return run(params, remaining, pending, firstError, true);
      return run(params, rest, [...pending, { index, error, phase }], firstError ?? error);
    };
    let result: object;
    try {
      result = (await (hosts[index] as ClickHouseClient).query(params as never)) as object;
    } catch (error) {
      return failOver(error, "query", unconfirmed);
    }
    unhealthyUntil[index] = 0;
    unconfirmed.forEach(markUnhealthy);
    return guardBody(result, (error) => failOver(error, "body", []));
  };

  const overrides: Record<string | symbol, unknown> = {
    query: (params: unknown) => run(params, hostOrder()),
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
    hosts,
  };
  return new Proxy(primary, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function hostsOf(ch: ClickHouseClient): ClickHouseClient[] {
  return (ch as unknown as { hosts?: ClickHouseClient[] }).hosts ?? [ch];
}

export function parseHostList(rawUrls: string): URL[] {
  const urls = splitHosts(rawUrls).map((part, index) => {
    const url = URL.canParse(part) ? new URL(part) : null;
    if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
      throw new Error(`ClickHouse url list entry ${index} is not a valid http(s) url (the entry is not shown: it holds a password)`);
    }
    return url;
  });
  if (urls.length === 0) throw new Error("no ClickHouse host in the url list");
  return urls;
}

export function createFailoverClient(
  rawUrls: string,
  build: (url: URL) => ClickHouseClient,
  options: Omit<FailoverOptions, "labels"> = {},
): ClickHouseClient {
  const urls = parseHostList(rawUrls);
  return failoverAcrossHosts(urls.map(build), { ...options, labels: urls.map((url) => url.host) });
}
