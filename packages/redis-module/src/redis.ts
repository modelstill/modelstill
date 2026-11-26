import { Redis, type RedisOptions } from "ioredis";
import { logger } from "@modelstill/logger";

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls?: boolean;
  failFast?: boolean;
}

export interface CacheRedisTarget {
  host?: string;
  port?: string | number;
}

const DEFAULT_PORT = 6379;
const FAIL_FAST_COMMAND_TIMEOUT_MS = 2_000;

export function cacheRedisConfig(target: CacheRedisTarget): RedisConfig | undefined {
  const host = target.host?.trim();
  if (!host) return undefined;
  const port = Number(target.port);
  return { host, port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT, failFast: true };
}

export function buildOptions(config: RedisConfig): RedisOptions {
  const failFast: RedisOptions = config.failFast
    ? { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: FAIL_FAST_COMMAND_TIMEOUT_MS }
    : { maxRetriesPerRequest: null };
  return {
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db ?? 0,
    tls: config.tls ? {} : undefined,
    enableReadyCheck: true,
    ...failFast,
  };
}

export class RedisClient {
  readonly redis: Redis;

  constructor(config: RedisConfig) {
    this.redis = new Redis(buildOptions(config));
    this.redis.on("error", (err) =>
      logger.error("Redis error", { err: String(err) }),
    );
  }

  getClient(): Redis {
    return this.redis;
  }

  duplicate(): Redis {
    return this.redis.duplicate();
  }

  async set(key: string, value: string, ttl?: number) {
    if (ttl) return this.redis.set(key, value, "EX", ttl);
    return this.redis.set(key, value);
  }

  async get<T = string>(key: string, defaultValue?: T): Promise<T> {
    const result = await this.redis.get(key);
    return (result ?? defaultValue) as T;
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }
}
