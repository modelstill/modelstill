import { describe, expect, jest, test } from "bun:test";
import type { Redis } from "ioredis";
import { LEAVE_PENDING, StreamConsumer, publishToStream } from "../src/stream.ts";

function fakeRedis(n: number) {
  let next = 0;
  const acked: string[] = [];
  const reads: number[] = [];
  const sweeps: unknown[][] = [];
  const renewals: unknown[][] = [];
  const redis = {
    duplicate() {
      return redis;
    },
    disconnect() {},
    async xautoclaim(...args: unknown[]) {
      sweeps.push(args);
      return ["0-0", [], []];
    },
    async xclaim(...args: unknown[]) {
      renewals.push(args);
      return [];
    },
    async xreadgroup(...args: unknown[]) {
      const count = Number(args[4]);
      reads.push(count);
      if (next >= n) return null;
      const entries: [string, string[]][] = [];
      for (let i = 0; i < count && next < n; i++, next++)
        entries.push([`${next}-0`, ["payload", String(next)]]);
      return [["s", entries]];
    },
    async xack(_s: string, _g: string, id: string) {
      acked.push(id);
    },
  };
  return { redis: redis as unknown as Redis, acked, reads, sweeps, renewals };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

describe("StreamConsumer in-flight bound", () => {
  test("bounded: readBatch returns once entries are started and never exceeds the bound", async () => {
    const { redis, acked, reads } = fakeRedis(5);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 2);
    let running = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const handler = () =>
      new Promise<void>((r) => {
        running++;
        peak = Math.max(peak, running);
        release.push(() => {
          running--;
          r();
        });
      });

    const first = await consumer.readBatch(handler, 20, 0);
    expect(first).toBe(2);
    expect(reads[0]).toBe(2);
    expect(running).toBe(2);

    let secondDone = false;
    const second = consumer.readBatch(handler, 20, 0).then((n) => {
      secondDone = true;
      return n;
    });
    await tick();
    expect(secondDone).toBe(false);

    release.shift()!();
    await tick();
    await tick();
    expect(await second).toBe(1);
    expect(peak).toBe(2);
    expect(acked).toEqual(["0-0"]);

    while (release.length) {
      release.shift()!();
      await tick();
      await consumer.readBatch(handler, 20, 0);
      await tick();
    }
    expect(peak).toBe(2);
  });

  test("unbounded (default): readBatch waits for the whole batch, as before", async () => {
    const { redis, acked } = fakeRedis(3);
    const consumer = new StreamConsumer(redis, "s", "g", "c");
    let finished = 0;
    const n = await consumer.readBatch(async () => {
      await tick();
      finished++;
    }, 10, 0);
    expect(n).toBe(3);
    expect(finished).toBe(3);
    expect(acked.length).toBe(3);
  });

  test("bounded: a throwing handler frees its slot and the loop keeps reading", async () => {
    const { redis, acked } = fakeRedis(2);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 1);
    await consumer.readBatch(() => {
      throw new Error("boom");
    }, 5, 0);
    await tick();
    await tick();
    expect(acked).toEqual(["0-0"]);
    expect(await consumer.readBatch(() => undefined, 5, 0)).toBe(1);
  });
});

test("publishToStream caps the stream length (consumer groups never delete acked entries)", async () => {
  const calls: unknown[][] = [];
  const redis = { xadd: async (...a: unknown[]) => { calls.push(a); return "1-0"; } } as unknown as Redis;
  await publishToStream(redis, "s", { payload: "x" });
  expect(calls[0].slice(0, 4)).toEqual(["s", "MAXLEN", "~", "20000"]);
  expect(calls[0].slice(4)).toEqual(["*", "payload", "x"]);
});

test("entries a dead consumer left pending are claimed and handled before new ones", async () => {
  const acked: string[] = [];
  const seen: string[] = [];
  const redis = {
    duplicate() {
      return redis;
    },
    async xautoclaim() {
      return ["0-0", [["7-0", ["payload", "stale"]]], []];
    },
    async xreadgroup() {
      return [["s", [["8-0", ["payload", "fresh"]]]]];
    },
    async xack(_s: string, _g: string, id: string) {
      acked.push(id);
    },
  } as unknown as Redis;
  const consumer = new StreamConsumer(redis, "s", "g", "c");
  await consumer.readBatch((d) => {
    seen.push(d.payload);
  }, 10, 0);
  expect(seen).toEqual(["stale"]);
  expect(acked).toEqual(["7-0"]);
  await consumer.readBatch((d) => {
    seen.push(d.payload);
  }, 10, 0);
  expect(seen).toEqual(["stale", "fresh"]);
});

describe("StreamConsumer leases", () => {
  const LEASE_MS = 10_000;

  test("an entry still being handled has its lease renewed by id, so a sweep cannot take it", async () => {
    jest.useFakeTimers();
    const { redis, renewals } = fakeRedis(2);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 4);
    const release: (() => void)[] = [];
    await consumer.readBatch(() => new Promise<void>((r) => release.push(r)), 10, 0);
    expect(renewals).toEqual([]);

    jest.advanceTimersByTime(LEASE_MS / 4);
    expect(renewals).toEqual([["s", "g", "c", 0, "0-0", "1-0", "JUSTID"]]);

    jest.advanceTimersByTime(LEASE_MS);
    expect(renewals.length).toBe(5);
    consumer.close();
    jest.useRealTimers();
  });

  test("a finished entry is no longer renewed, and nothing is sent when nothing is held", async () => {
    jest.useFakeTimers();
    const { redis, renewals } = fakeRedis(2);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 4);
    const release: (() => void)[] = [];
    await consumer.readBatch(() => new Promise<void>((r) => release.push(r)), 10, 0);
    release[0]();
    await settle();
    jest.advanceTimersByTime(LEASE_MS / 4);
    expect(renewals.at(-1)).toEqual(["s", "g", "c", 0, "1-0", "JUSTID"]);

    release[1]();
    await settle();
    const sent = renewals.length;
    jest.advanceTimersByTime(LEASE_MS);
    expect(renewals.length).toBe(sent);
    consumer.close();
    jest.useRealTimers();
  });

  test("the sweep takes only entries whose lease ran out, and no more than the free slots", async () => {
    const { redis, sweeps } = fakeRedis(1);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 3);
    await consumer.readBatch(() => new Promise<void>(() => undefined), 10, 0);
    expect(sweeps[0]).toEqual(["s", "g", "c", LEASE_MS, "0-0", "COUNT", 3]);
    consumer.close();
  });

  test("close() ends renewal for good", async () => {
    jest.useFakeTimers();
    const { redis, renewals } = fakeRedis(1);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 4);
    await consumer.readBatch(() => new Promise<void>(() => undefined), 10, 0);
    consumer.close();
    jest.advanceTimersByTime(LEASE_MS);
    expect(renewals).toEqual([]);
    jest.useRealTimers();
  });
});

describe("StreamConsumer retry by leaving an entry pending", () => {
  test("a handler answering LEAVE_PENDING is not acked, so a later sweep re-runs it", async () => {
    const { redis, acked } = fakeRedis(2);
    const consumer = new StreamConsumer(redis, "s", "g", "c");
    const handled = await consumer.readBatch(
      (d) => (d.payload === "0" ? LEAVE_PENDING : undefined),
      10,
      0,
    );
    expect(handled).toBe(2);
    expect(acked).toEqual(["1-0"]);
  });

  test("the handler is told the entry id, whose time part dates the entry", async () => {
    const { redis } = fakeRedis(1);
    const consumer = new StreamConsumer(redis, "s", "g", "c");
    const ids: string[] = [];
    await consumer.readBatch((_d, id) => {
      ids.push(id);
    }, 10, 0);
    expect(ids).toEqual(["0-0"]);
  });

  test("an entry left pending drops out of the lease renewals, so its idle time counts towards the sweep", async () => {
    jest.useFakeTimers();
    const { redis, renewals, acked } = fakeRedis(2);
    const consumer = new StreamConsumer(redis, "s", "g", "c", 4);
    const release: (() => void)[] = [];
    await consumer.readBatch(
      (d) =>
        new Promise<void | typeof LEAVE_PENDING>((r) => {
          release.push(() => r(d.payload === "0" ? LEAVE_PENDING : undefined));
        }),
      10,
      0,
    );
    release[0]!();
    await settle();
    jest.advanceTimersByTime(10_000 / 4);
    expect(renewals.at(-1)).toEqual(["s", "g", "c", 0, "1-0", "JUSTID"]);
    expect(acked).toEqual([]);
    release[1]!();
    await settle();
    expect(acked).toEqual(["1-0"]);
    consumer.close();
    jest.useRealTimers();
  });

  test("the next sweep hands a left-pending entry back to a handler, which may then ack it", async () => {
    const acked: string[] = [];
    const seen: string[] = [];
    let leftover: [string, string[]] | null = null;
    let sweeps = 0;
    const redis = {
      duplicate() {
        return redis;
      },
      disconnect() {},
      async xautoclaim() {
        sweeps++;
        const claimed = leftover ? [leftover] : [];
        leftover = null;
        return ["0-0", claimed, []];
      },
      async xreadgroup() {
        return [["s", [["5-0", ["request_id", "cr_1"]]]]];
      },
      async xack(_s: string, _g: string, id: string) {
        acked.push(id);
      },
    } as unknown as Redis;
    const consumer = new StreamConsumer(redis, "s", "g", "c");
    let brokerUp = false;
    const handler = (d: Record<string, string>) => {
      seen.push(d.request_id!);
      return brokerUp ? undefined : LEAVE_PENDING;
    };
    await consumer.readBatch(handler, 10, 0);
    expect(seen).toEqual(["cr_1"]);
    expect(acked).toEqual([]);
    leftover = ["5-0", ["request_id", "cr_1"]];
    brokerUp = true;
    (consumer as unknown as { lastClaim: number }).lastClaim = 0;
    await consumer.readBatch(handler, 10, 0);
    expect(sweeps).toBe(2);
    expect(seen).toEqual(["cr_1", "cr_1"]);
    expect(acked).toEqual(["5-0"]);
  });

  test("a handler that throws is acked, unlike one that asks to be left pending", async () => {
    const { redis, acked } = fakeRedis(2);
    const consumer = new StreamConsumer(redis, "s", "g", "c");
    await expect(
      consumer.readBatch((d) => {
        if (d.payload === "0") throw new Error("boom");
        return LEAVE_PENDING;
      }, 10, 0),
    ).rejects.toThrow("boom");
    expect(acked).toEqual(["0-0"]);
  });
});
