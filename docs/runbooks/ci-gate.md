# Release gate on pull requests

Code: `python/modelstill/src/modelstill/report.py` (the report), `.github/actions/modelstill-gate/`
(the composite action). Example workflow: [`docs/examples/modelstill-gate.yml`](../examples/modelstill-gate.yml).
Decision: [ADR 0016](../decisions/0016-ai-quality-platform.md).

## What it does

`modelstill report gate` reads a run history, decides the task spec's gate (the same `decide` as
`modelstill push gate`, but nothing is sent to the API) and prints the result below. Both commands
use the same exit codes (0 pass, 2 fail, 1 error); `push gate` records a failed decision before
exiting 2, so a CI job that pushes the gate fails on a failed gate. The report:

- every check with its threshold, measured value, interval and result;
- the paired comparison against the baseline: the difference with its bootstrap interval, the
  verdict, fixed and broken counts;
- the worst regressed cases (`--top`, default 5), worst drop first, ties by case id.

```bash
modelstill report gate evals/history.jsonl <run> --spec tasks/<task>/spec.yaml \
  --previous <baseline-run> --flip-rate 0.004 --cost-ratio 0.31 --p95-latency-ms 870 \
  --format markdown
```

| Exit code | Meaning |
|---|---|
| 0 | every check passed |
| 2 | the gate failed; the report is still printed |
| 1 | an error (unknown run, bad spec, a `max_regression` gate without `--previous`) |

`--format json` prints the same decision as JSON (`passed`, `run`, `previous`, `metric`,
`checks[]` with `direction`, `threshold`, `value`, `interval`, `passed`, then `comparison` and
`regressions`). Store it next to the run if the decision must be re-read later.

Intervals: the metric interval is the run's own (Clopper-Pearson for binary scores, bootstrap
otherwise, or the named metric's with `--primary-metric`). The regression check's interval is the
paired bootstrap interval of the difference; its measured value is the lower bound. Flip rate,
cost ratio and p95 latency are measured outside ModelStill and passed in, so they show
"not sampled". A value that was not measured is passed at a failing worst case (for example
`--flip-rate 1`), never at a passing one.

## The action

Inputs: `spec`, `history`, `run`, `baseline`, `flip-rate`, `cost-ratio`, `p95-latency-ms`,
`primary-metric`, `python-version` (default 3.12), `package` (default `modelstill==0.1.0`; use a
pinned git URL such as `modelstill @ git+https://...@<sha>#subdirectory=python/modelstill`
until a release is on PyPI), `working-directory`, `github-token` (default `github.token`).

Steps:

1. `astral-sh/setup-uv`, pinned by commit to the same version as this repository's CI (0.13.7).
2. Install `package` into a virtualenv under `$RUNNER_TEMP`.
3. Run the report to `$RUNNER_TEMP/modelstill-gate.md` and copy it into the job summary. Exit
   codes 0 and 2 continue; anything else stops the job.
4. On `pull_request` events, post the report as a comment, or edit the earlier one. The comment
   is found by its hidden first line, an HTML comment holding `modelstill-gate`, so each pull
   request keeps one comment however often the job runs. It uses `gh api` with `GH_TOKEN` from
   `github-token`.
5. Fail the job when the gate failed, after the comment is posted.

Inputs reach the scripts only through `env`, never by `${{ }}` inside `run`, so a branch name or
input cannot inject shell.

## Wiring it into a repository

1. Copy `docs/examples/modelstill-gate.yml` into `.github/workflows/` of the application's
   repository. Replace `COMMIT_SHA` in `modelstill/modelstill/...@COMMIT_SHA` with a full commit
   SHA, and `tasks/TASK` with the task.
2. Give the job `pull-requests: write` (and `contents: read`). Nothing else is needed: the gate
   reads only the history file, so no provider key goes into the workflow.
3. Make the step before the action record the candidate run and print `run=<id>`,
   `flip_rate=...`, `cost_ratio=...` and `p95_latency_ms=...` to `$GITHUB_OUTPUT`.
4. Set the repository variable `MODELSTILL_BASELINE_RUN` to the accepted baseline
   (`modelstill eval accept`), and update it when a new baseline is accepted.

Pull requests from forks get a read-only `GITHUB_TOKEN`, so the comment step fails there; the
report is still in the job summary. Do not switch to `pull_request_target` to work around this
unless the eval step never runs code from the fork.

## Checks run on this repository

- `uv run --extra dev pytest -q tests/test_report.py tests/test_gate_action.py` in
  `python/modelstill`: the report, and the action's inputs, pins, marker and step order.
- `bash .github/scripts/no-comments.sh` covers `.github/actions/**` and `docs/examples/**`.
- actionlint 1.7.7 through Docker, on a scratch copy where the example uses the action by its local
  path (actionlint checks a composite action through the workflow that uses it):

  ```bash
  docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color=false
  ```

  The `run` blocks also pass `shellcheck` when extracted. Both were clean on 24 Nov 2026.
