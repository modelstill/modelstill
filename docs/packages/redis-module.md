# @modelstill/redis-module

## Cache connection

`cacheRedisConfig` returns the config of the connection for an app's rebuildable caches (the `redis-cache` instance), or
undefined while no host is set; the caller then keeps its caches on its main Redis.

It sets `failFast`, for a cache where a miss is the answer to any fault: a command sent while
Redis is away is rejected at once instead of queued until it returns, and a command on a stuck
connection is given up after two seconds. Never set `failFast` for state, which must wait rather
than skip a write.

## Streams

- `STALE_MS`: a pending entry older than this belongs to a consumer that died. It is well under the
  callers' 25-30 s timeouts.
- A handler returns `LEAVE_PENDING` to leave its entry pending: it is not acked, and a later
  sweep re-runs it.
- **Length cap (`STREAM_MAXLEN`).** Consumer groups never delete acked entries, so without a cap the stream keeps every
  request ever made, with its full payload. `~` trims in whole nodes; the cap is far above any
  live backlog.
- **`maxInflight`** bounds the handlers running at once across `readBatch` calls. With it set,
  `readBatch` returns as soon as its entries are started, so the caller's loop reads again while they
  run; without it (the default) `readBatch` waits for the batch to finish. The lock-step form caps a
  consumer at one batch per round trip: the slowest item in a batch idles every other slot.
- **Self-healing.** An entry a dead consumer (a pod killed mid-request by a scale-down or a crash)
  never acked stays pending forever, and its caller waits out its whole timeout. Entries pending on
  any consumer of the group for longer than `STALE_MS` are claimed first and re-run. The claim is
  rate-limited, so the next read after a claim goes to the stream itself.
- A handler that throws only loses its own entry; the loop keeps reading.

The stream tests build a stream with `n` queued entries; `xreadgroup` hands out up to `COUNT` of
them per call. With both `maxInflight` slots busy, the next read waits for a completion instead of
reading more.
