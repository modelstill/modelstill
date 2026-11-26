import type { Redis } from "ioredis";

const STREAM_MAXLEN = 20_000;
const STALE_MS = 10_000;
const LEASE_RENEW_EVERY_MS = STALE_MS / 4;
const UNBOUNDED_CLAIM_COUNT = 50;

export const LEAVE_PENDING = "leave-pending" as const;

export type StreamHandler = (
  data: Record<string, string>,
  id: string,
) => Promise<void | typeof LEAVE_PENDING> | void | typeof LEAVE_PENDING;

export async function publishToStream(
  redis: Redis,
  stream: string,
  data: Record<string, string>,
): Promise<void> {
  const args: string[] = [];
  for (const [key, value] of Object.entries(data)) args.push(key, value);
  await (
    redis as unknown as { xadd: (...a: unknown[]) => Promise<string> }
  ).xadd(stream, "MAXLEN", "~", String(STREAM_MAXLEN), "*", ...args);
}

export class StreamConsumer {
  private inflight = 0;
  private waiters: (() => void)[] = [];
  private lastClaim = 0;
  private readonly held = new Set<string>();
  private readonly leaseConnection: Redis;
  private leaseRenewal?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly redis: Redis,
    private readonly stream: string,
    private readonly group: string,
    private readonly consumer: string,
    private readonly maxInflight = 0,
  ) {
    this.leaseConnection = redis.duplicate();
  }

  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        "CREATE",
        this.stream,
        this.group,
        "$",
        "MKSTREAM",
      );
    } catch (err) {
      if (!String((err as Error)?.message).includes("BUSYGROUP")) throw err;
    }
  }

  async readBatch(
    handler: StreamHandler,
    count = 10,
    blockMs = 5000,
  ): Promise<number> {
    const bounded = this.maxInflight > 0;
    if (bounded) {
      while (this.inflight >= this.maxInflight)
        await new Promise<void>((r) => this.waiters.push(r));
      count = Math.min(count, this.maxInflight - this.inflight);
    }
    const stale = await this.claimStale(bounded ? count : UNBOUNDED_CLAIM_COUNT);
    if (stale) return this.run(stale, handler, bounded);
    const res = (await (
      this.redis as unknown as {
        xreadgroup: (...a: unknown[]) => Promise<unknown>;
      }
    ).xreadgroup(
      "GROUP",
      this.group,
      this.consumer,
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      this.stream,
      ">",
    )) as [string, [string, string[]][]][] | null;

    if (!res) return 0;
    const entries: [string, string[]][] = [];
    for (const [, batch] of res) entries.push(...batch);
    return this.run(entries, handler, bounded);
  }

  private async claimStale(count: number): Promise<[string, string[]][] | null> {
    if (Date.now() - this.lastClaim < STALE_MS / 2) return null;
    this.lastClaim = Date.now();
    const res = (await (
      this.redis as unknown as {
        xautoclaim: (...a: unknown[]) => Promise<unknown>;
      }
    ).xautoclaim(this.stream, this.group, this.consumer, STALE_MS, "0-0", "COUNT", count)) as
      | [string, [string, string[]][], string[]?]
      | null;
    const entries = res?.[1]?.filter((e) => Array.isArray(e) && e[1]) ?? [];
    return entries.length ? entries : null;
  }

  close(): void {
    this.closed = true;
    if (this.leaseRenewal) clearInterval(this.leaseRenewal);
    this.leaseConnection.disconnect();
  }

  private hold(id: string): void {
    this.held.add(id);
    if (this.leaseRenewal || this.closed) return;
    this.leaseRenewal = setInterval(() => this.renewLeases(), LEASE_RENEW_EVERY_MS);
    this.leaseRenewal.unref?.();
  }

  private renewLeases(): void {
    if (!this.held.size) return;
    this.leaseConnection
      .xclaim(this.stream, this.group, this.consumer, 0, ...this.held, "JUSTID")
      .catch(() => undefined);
  }

  private async run(
    entries: [string, string[]][],
    handler: StreamHandler,
    bounded: boolean,
  ): Promise<number> {
    let handled = 0;
    const tasks: Promise<void>[] = [];
    for (const [id, fields] of entries) {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) data[fields[i]] = fields[i + 1];
      handled++;
      this.inflight++;
      this.hold(id);
      const task = (async () => {
        let leave = false;
        try {
          leave = (await handler(data, id)) === LEAVE_PENDING;
        } finally {
          this.held.delete(id);
          if (!leave) await this.redis.xack(this.stream, this.group, id);
          this.inflight--;
          for (const wake of this.waiters.splice(0)) wake();
        }
      })();
      if (bounded) {
        task.catch(() => undefined);
      } else {
        tasks.push(task);
      }
    }
    if (!bounded) await Promise.all(tasks);
    return handled;
  }
}
