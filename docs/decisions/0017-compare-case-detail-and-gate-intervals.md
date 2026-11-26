# 0017. Store each eval case's input and expected answer, and give gate checks their interval

- **Status:** accepted (24 Nov 2026)
- **Date:** 2026-11-24
- **Deciders:** dashboard maintainers

## Context

A comparison needs more than averages and deltas: per-row improvement and regression counts, a
side-by-side view of one row, and intervals and tests that say whether a change is real. Our
compare page showed the paired difference and the fixed and broken counts, but not the outputs,
the expected answer or per-metric differences, because `eval_scores` kept only the output and one
score per case. The gate page showed each threshold and measured value, but not the interval a
check was read from or why a check was recorded at a worst-case value.

## Decision

1. `eval_scores` gains two nullable `jsonb` columns, `input` and `expected` (migration
   `0005_compare_case_detail`). A pushed case may carry `input`, `expected` and `metrics`
   (per-case values, stored with `score` in the existing `metrics` column).
2. `GET /v1/eval-runs/compare` adds `pairedCases`, an exact two-sided sign test of fixed against
   broken, and `metrics`: each named metric with both runs' estimates and, when both runs logged
   it per case, a paired bootstrap difference with its interval and verdict. A metric with only
   run-level values gets a difference and no interval.
3. `GET /v1/eval-runs/compare/case` returns one case from both runs: input, expected answer, both
   outputs and their per-case scores.
4. Gate checks are returned with `estimate`, `low`, `high`, `measured` and `reason`. The interval
   is derived at read time from the stored runs (`metric_lower_bound` from the run headline,
   `regression_vs_baseline` from the paired comparison). A check is not measured when it says so,
   when the gate report lists it under `notMeasured`, or when it failed at exactly the documented
   worst-case value (`flip_rate` 1, `cost_ratio` 9, `p95_latency_ms` 99999).

## Consequences

- Runs pushed before the migration have no input or expected answer; the case view falls back to
  the review item with the same input hash and otherwise says the run was pushed without inputs.
- `modelstill push run` sends `input`, `expected` and per-case `metrics` when the history entry
  holds them (history records them from 24 Nov 2026); `--no-content` sends only hashes, scores and
  per-case metrics. `modelstill push gate` writes `notMeasured` for checks at the worst-case values.
- The worst-case sentinel rule depends on the values in the agent skill; if those change, change
  `WORST_CASE_VALUES` in `apps/api/src/gate-checks.ts` with them.
- Listing gates now reads the gated runs' scores and reruns a seeded bootstrap per gate; the result
  is deterministic, and the cost grows with cases times gates listed.

## Alternatives considered

- **Keep input and expected only in dataset items:** eval runs on a benchmark have no dataset items,
  so the compare page would show outputs without the question or the answer.
- **Store the interval on each check at write time:** the Python gate does not compute it today,
  and deriving it from stored runs also covers every gate already recorded.

## Links

- Runbooks: `../runbooks/scorers.md`
- Code: `apps/api/src/gate-checks.ts`, `apps/api/src/stats.ts`, `apps/api/drizzle/0005_compare_case_detail.sql`,
  `apps/website/src/app/(dashboard)/tasks/[slug]/evals/compare/page.tsx`
