# 0003. Gate students relative to the accepted baseline

Date: 2026-11-23
Status: accepted

## Context

The first task's gate used a fixed floor (`lower_ci_min`) set just below the point score of the
cloud model it would replace. On a gold set of a few hundred items, that cloud model's own lower
bound fell under the floor: the cloud model would fail the gate set for its replacement. On a test
set this small, a fixed floor near the baseline's point score mostly measures the set's size.

## Decision

A gate may set `max_regression`: the paired difference (student minus accepted baseline, case
by case on the same gold set) must have a lower bound no worse than minus that margin. A fixed
`lower_ci_min` stays available, and both rules can apply together. A gate needs at least one.

The example task `tasks/ticket-priority` uses `max_regression: 0.02` on its `correct_priority`
requirement.

## Consequences

- Every gate decision needs an accepted baseline run on the same benchmark version.
- A larger gold set tightens the paired interval and lets a good student pass sooner; the
  review queue is how the gold set grows.
- The paired comparison runs on per-case scores; a pooled metric such as pooled F1 is reported
  beside it.
