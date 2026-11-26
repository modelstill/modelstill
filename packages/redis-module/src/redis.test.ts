import { describe, expect, test } from "bun:test";
import { buildOptions, cacheRedisConfig } from "./redis.ts";

describe("cacheRedisConfig", () => {
  test("is absent while no cache host is set, so the caller stays on its main Redis", () => {
    expect(cacheRedisConfig({})).toBeUndefined();
    expect(cacheRedisConfig({ host: undefined, port: "6380" })).toBeUndefined();
    expect(cacheRedisConfig({ host: "  " })).toBeUndefined();
  });

  test("names the cache instance and makes it fail fast", () => {
    expect(cacheRedisConfig({ host: "redis-cache" })).toEqual({ host: "redis-cache", port: 6379, failFast: true });
    expect(cacheRedisConfig({ host: " redis-cache ", port: "6380" })).toEqual({ host: "redis-cache", port: 6380, failFast: true });
    expect(cacheRedisConfig({ host: "redis-cache", port: 6381 })).toEqual({ host: "redis-cache", port: 6381, failFast: true });
  });

  test("falls back to the default port when the port is blank or not a number", () => {
    expect(cacheRedisConfig({ host: "redis-cache", port: "" })?.port).toBe(6379);
    expect(cacheRedisConfig({ host: "redis-cache", port: "abc" })?.port).toBe(6379);
  });
});

describe("buildOptions", () => {
  test("a state connection queues commands and waits for Redis, as before", () => {
    const options = buildOptions({ host: "redis", port: 6379 });
    expect(options.maxRetriesPerRequest).toBeNull();
    expect(options.enableOfflineQueue).toBeUndefined();
    expect(options.commandTimeout).toBeUndefined();
  });

  test("a fail-fast connection rejects at once while Redis is away and bounds a stuck command", () => {
    const options = buildOptions({ host: "redis-cache", port: 6379, failFast: true });
    expect(options.enableOfflineQueue).toBe(false);
    expect(options.maxRetriesPerRequest).toBe(1);
    expect(options.commandTimeout).toBe(2_000);
  });
});
