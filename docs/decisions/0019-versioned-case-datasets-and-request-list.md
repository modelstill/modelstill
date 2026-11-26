# 0019. Case datasets are append-only versions; the request list reads serving_events as stored

- **Status:** proposed
- **Date:** 2026-11-24
- **Deciders:** dashboard maintainers

## Context

The datasets page was read-only. People need to import cases from CSV or JSONL, edit rows and add
or delete them from the browser. AGENTS.md says artifact and snapshot paths are never overwritten,
and a benchmark's identity in python is `Benchmark.version`: the sha256 of
`json.dumps([[id, input, expected, tags], ...], sort_keys=True, separators=(",", ":"))`
(`python/modelstill/src/modelstill/benchmark.py`). Eval runs store that hash as
`benchmark_version`.

The traffic page showed hourly aggregates only. `modelstill.serving_events` (ClickHouse) keeps one
row per gateway call with both answers, the deferral reason, latencies and costs, but only a
16-character hash of the request messages (`serve/events.py`). Request bodies are not stored.

## Decision

1. Three Postgres tables (migration `0006_case_datasets`): `case_datasets` (one per task and
   name), `case_dataset_versions` (dataset, number, hash, parent, row count, change, author) and
   `case_rows` (one revision per row per version; a delete is a revision with `deleted = true`).
   Rows and versions are only ever inserted. A version's rows are each row's newest revision at or
   below that version number.
2. Every write (create, import, add, edit, delete) makes exactly one new version. Edits and
   deletes must name the version they were made against (`baseVersion`); a stale write gets 409
   with the current head, and the dashboard asks the user to reload instead of merging.
3. A version's `hash` is computed the way `Benchmark.version` computes it, with tags read from a
   list of strings under `metadata.tags`, so an exported version (`.../export`, benchmark JSONL)
   loaded by `load_benchmark` has the same version as the dataset. A test pins one hash computed by
   python. Known gap: JSON numbers like `2.0` lose their `.0` in JavaScript, so a row holding such a
   float hashes differently in python.
4. `GET /v1/requests` pages `serving_events` newest first by `(ts, request_hash)` with an opaque
   cursor, filtered by task, deferral and a time window (default the last 7 days). Every query
   carries the same `SETTINGS` limits as the hourly traffic query. `CLICKHOUSE_DATABASE` (default
   `modelstill`) selects the database, so a test database can sit beside the real one.
5. The request list does not add body storage. It says the body is not stored; "Add to review"
   queues the request hash with both answers, and "Add to dataset" writes a case whose input is
   `{"requestHash": ...}` for a person to fill in. Storing bodies needs its own setting that
   defaults to off, its own ADR and a retention rule.

## Consequences

- Any past version can be read and exported exactly as it was; a run's `benchmark_version` can be
  matched to a dataset version.
- Storage grows by one row revision per edit, which is small next to eval scores.
- The dashboard saves edits one at a time on the newest version; two people editing the same
  dataset at once will see a conflict and reload.
- Cases made from production requests are not runnable until their input is filled in.

## Alternatives considered

- Copy every row into each version: simple reads, but an edit to one row of a 10k-row dataset
  writes 10k rows.
- Reuse `datasets` / `dataset_items`: those are tied to a task version and hold teacher answers for
  review, not reference cases; mixing them would change what training reads.
- Store request bodies now: rejected without a default-off setting and a retention decision.

## Links

- Code: `apps/api/src/datasets.ts`, `apps/api/src/datasets-postgres.ts`,
  `apps/api/src/routers/datasets.router.ts`, `apps/api/src/routers/requests.router.ts`,
  `apps/api/src/traffic-clickhouse.ts`, `apps/website/src/components/datasets/`,
  `apps/website/src/components/traffic/request-list.tsx`
- Runbooks: `../runbooks/deploy.md`
