import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createApp, DEFAULT_CORS_ORIGINS, DEFAULT_FRONTEND_URL, DEFAULT_MCP_RESOURCE } from "./app.ts";
import { parseAllowedEmails } from "./auth/allowed-emails.ts";
import { createAuth, inMemoryAuthDatabase } from "./auth/index.ts";
import { connect, type Database } from "./db/client.ts";
import { authSchema } from "./db/schema.ts";
import { createMemoryStore } from "./store-memory.ts";
import { createPostgresStore } from "./store-postgres.ts";
import type { Store } from "./store.ts";
import { createMemoryDatasets } from "./datasets-memory.ts";
import { createPostgresDatasets } from "./datasets-postgres.ts";
import type { CaseDatasetStore } from "./datasets.ts";
import { noRequests, type RequestLog } from "./requests.ts";
import { createClickHouseTraffic, DEFAULT_CLICKHOUSE_DATABASE } from "./traffic-clickhouse.ts";
import { noTraffic, type TrafficStore } from "./traffic.ts";

export const DEFAULT_PORT = 8787;

export type ServerEnv = Record<string, string | undefined>;

type Backing = { store: Store; datasets: CaseDatasetStore; storeKind: "postgres" | "memory"; db: Database | null };

function chooseStore(env: ServerEnv): Backing {
  const url = env["DATABASE_URL"];
  if (!url) return { store: createMemoryStore(), datasets: createMemoryDatasets(), storeKind: "memory", db: null };
  const { db } = connect(url);
  return { store: createPostgresStore(db), datasets: createPostgresDatasets(db), storeKind: "postgres", db };
}

type TrafficBacking = { traffic: TrafficStore; requests: RequestLog; trafficKind: "clickhouse" | "none"; clickhouseDatabase: string | null };

function chooseTraffic(env: ServerEnv): TrafficBacking {
  const url = env["CLICKHOUSE_URL"];
  if (!url) return { traffic: noTraffic, requests: noRequests, trafficKind: "none", clickhouseDatabase: null };
  const database = env["CLICKHOUSE_DATABASE"] || DEFAULT_CLICKHOUSE_DATABASE;
  const clickhouse = createClickHouseTraffic({ url, user: env["CLICKHOUSE_USER"], password: env["CLICKHOUSE_PASSWORD"], database });
  return { traffic: clickhouse, requests: clickhouse, trafficKind: "clickhouse", clickhouseDatabase: database };
}

function list(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries?.length ? entries : undefined;
}

function authDatabase(db: Database | null) {
  return db ? drizzleAdapter(db, { provider: "pg", schema: authSchema }) : inMemoryAuthDatabase();
}

export function createServer(env: ServerEnv) {
  const { store, datasets, storeKind, db } = chooseStore(env);
  const { traffic, requests, trafficKind, clickhouseDatabase } = chooseTraffic(env);
  const port = Number(env["PORT"] ?? DEFAULT_PORT);
  const frontendUrl = env["FRONTEND_URL"] || DEFAULT_FRONTEND_URL;
  const corsOrigins = list(env["CORS_ORIGINS"]) ?? [...new Set([new URL(frontendUrl).origin, ...DEFAULT_CORS_ORIGINS])];
  const auth = createAuth({
    baseURL: env["BETTER_AUTH_URL"] || `http://localhost:${port}`,
    secret: env["BETTER_AUTH_SECRET"] || undefined,
    frontendUrl,
    mcpResource: env["MCP_RESOURCE_URL"] || DEFAULT_MCP_RESOURCE,
    trustedOrigins: [...new Set([...corsOrigins, ...(list(env["TRUSTED_ORIGINS"]) ?? [])])],
    database: authDatabase(db),
    allowedEmails: parseAllowedEmails(env["MODELSTILL_ALLOWED_EMAILS"]),
  });
  const app = createApp({
    store,
    traffic,
    datasets,
    requests,
    corsOrigins,
    auth,
    frontendUrl,
    apiToken: env["MODELSTILL_API_TOKEN"] || undefined,
  });
  return {
    port,
    storeKind,
    datasetsKind: storeKind,
    authKind: storeKind,
    trafficKind,
    clickhouseDatabase,
    fetch: app.fetch,
  };
}
