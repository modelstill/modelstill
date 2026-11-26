# Scorers and reading a comparison

The eval runs page shows these templates when a task has no runs yet. Each scorer returns a
per-case score; the library adds the interval, so every reported score carries one
([AGENTS.md](../../AGENTS.md)).

## Exact match

`modelstill.evals.exact_match` scores 1 when the output equals the expected answer, else 0.

```python
from modelstill.evals import exact_match, run

result = run(cases, model, exact_match)
```

Binary scores get an exact Clopper-Pearson interval, never the normal approximation.

## Set F1

`modelstill.evals.set_f1` is F1 between the predicted and expected sets (tags, extracted names).
Two empty sets score 1.

```python
from modelstill.evals import run, set_f1

result = run(cases, model, set_f1)
```

Per-case scores get a seeded bootstrap interval. `micro_f1` reports pooled F1 with its own
interval beside it; push it as a named metric and make it the primary metric.

## JSON equal

`json_equal` parses the output as JSON and scores 1 when it equals the expected object. Dict
equality ignores key order. An answer that does not parse scores 0, so broken JSON never raises a
score. It is built in for canaries (`canary.metric: {ref: json_equal}`) and as a GRPO reward
(`--reward json_equal`). For an eval run, pass the same function:

```python
import json

def json_equal(output, expected):
    try:
        return 1.0 if json.loads(output) == expected else 0.0
    except ValueError:
        return 0.0
```

## LLM judge, checked against people

`modelstill.judges.LLMJudge` asks a rubric judge for PASS or FAIL. The judge never shares a model
family with the teacher that labelled the training data; `JudgePanel` refuses that.

```python
from modelstill.evals import judge_agreement
from modelstill.judges import LLMJudge, corrected_score, stability

judge = LLMJudge(model, family, instructions, complete)
agreement = judge_agreement(judge_verdicts, human_labels)
```

- `judge_agreement` gives accuracy with an exact interval, Cohen's kappa, false passes and false
  fails against the people's labels. Record kappa as a gate check (`judge_human_kappa`).
- `stability` re-asks the judge and reports how often its verdict flips.
- `corrected_score` combines many judge scores with a few human labels (prediction-powered
  inference), so the judge's bias does not move the reported score.

## Pairwise preference

`modelstill.judges.PairwiseJudge` picks the better of two answers to the same input: A, B or TIE.
Position bias is controlled by asking twice, once in each order. Only a verdict that holds in both
orders counts; a verdict that follows the position is an inconsistent tie.

```bash
modelstill eval pairwise runs.jsonl <before> <after> --spec tasks/<task>/spec.yaml \
  --base-url http://localhost:4000 --api-key-env LITELLM_API_KEY
modelstill eval pairwise runs.jsonl <before> <after> --judge-model <model> --judge-family <family> \
  --teacher-family qwen --teacher-family openai --base-url <url>
```

- **Judge and family rule:** the judge is the spec's `eval.judge`, or `--judge-model` and
  `--judge-family`. The teachers' families come from the spec or from `--teacher-family`
  (required). A judge from a teacher's family is refused, with the same check `JudgePanel` uses
  (`check_independent`).
- **Cases:** the two runs' shared case ids. The judge sees the case input and, when the history has
  it, the expected answer as a reference. It is called at temperature 0 through any
  OpenAI-compatible URL, two calls per case.
- **Report:** wins for each run, ties, the win rate of `<after>` over decisive cases with an exact
  Clopper-Pearson 95% interval, an exact two-sided sign test of wins against losses, and the
  inconsistency rate (cases whose verdict flipped with the order) with its own exact interval.
- **Verdict:** better when the win-rate interval is above 0.5, worse when it is below, otherwise no
  detectable difference. Ties never count as wins for either side.
- **High inconsistency** means the judge follows position or cannot tell the answers apart; read
  the win rate as weak evidence and try a stronger judge or sharper `--instructions`.

From Python, `pairwise_compare(judge, cases, teacher_families=...)` returns the same numbers and
every per-case verdict; `pairwise_cases(before_entry, after_entry)` builds the cases from two
history runs. As a scorer, `parity_metric(judge, teacher_families=...)` compares each output with
the expected answer and scores 1 unless the expected answer wins in both orders, so `run` reports
a parity rate with an exact interval:

```python
from modelstill.evals import run
from modelstill.judges import PairwiseJudge, parity_metric

judge = PairwiseJudge(model, family, instructions, complete)
result = run(cases, student, parity_metric(judge, teacher_families={"qwen", "openai"}))
```

## Pushing per-case detail

`POST /v1/tasks/{slug}/eval-runs` takes, for each case, `inputHash`, `score` and `output`, and
optionally `metrics` (per-case values, for example `{"exact_match": 1, "set_f1": 0.67}`), `input`
and `expected`. With per-case metrics in both runs, the compare page gives every metric a paired
difference with its interval; without them a metric shows both run-level values and a difference
with no interval. With `input` and `expected`, a selected case shows them beside both outputs. A
case without `input` falls back to the review item with the same `inputHash`.

`modelstill push run` sends all of it by default: the history file keeps each case's input and
expected answer from the benchmark, and per-case metrics from imported or pytest runs. Runs
recorded before history kept them are pushed without `input` and `expected`. For sensitive data,
`--no-content` sends only `inputHash`, `score` and per-case `metrics`, with no input, expected
answer or output:

```bash
modelstill push run history.jsonl <run> --task <slug>
modelstill push run history.jsonl <run> --task <slug> --no-content
```

## Reading a comparison

- **Paired difference:** the mean of after minus before over the cases both runs scored, with a
  seeded percentile bootstrap 95% interval (2,000 rounds, seed 0).
- **Verdict:** better when the interval is above zero, worse when it is below, otherwise no
  detectable difference. The mean alone never sets it.
- **Sign test:** exact two-sided binomial test of fixed against broken cases; unchanged cases do
  not count.
- **Cases:** sorted by the per-case change, worst first; filter by fixed, broken or unchanged.

## Gate checks that were not measured

A check that was not measured is recorded at a failing worst-case value, never as passing
(`--flip-rate 1 --cost-ratio 9 --p95-latency-ms 99999`). The gate page marks such a check "not
measured" and shows why. The API reads the reason, in this order, from:

1. the check itself: `{"measured": false, "reason": "..."}`;
2. the gate report: `"notMeasured": {"cost_ratio": "the bill was not exported"}` or a list of names;
3. a failed check whose value is exactly the documented worst case above.

`modelstill push gate` writes the report's `notMeasured` itself: every failed check at exactly its
worst-case value gets the default reason, and `--not-measured CHECK=REASON` (repeatable) names a
check and why, for example `--not-measured "cost_ratio=the bill was not exported"`. It refuses a
named check that passed or that the gate does not have. The constants are `WORST_CASE_VALUES` in
`python/modelstill/src/modelstill/push.py` and `apps/api/src/gate-checks.ts`; change both together.

`metric_lower_bound` is shown with the run's estimate and interval, and `regression_vs_baseline`
with the paired difference against the previous run.
