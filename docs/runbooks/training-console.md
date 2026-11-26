# Training console

The dashboard shows every training run of a task with its loss and eval curves by step. Runs reach
it two ways: `modelstill push train` sends a finished artifact afterwards, and `ConsoleReporter`
sends metrics while a run trains. Code: `apps/api/src/train-runs.ts`,
`python/modelstill/src/modelstill/push.py`, `python/modelstill/src/modelstill/train/console.py`,
`apps/website/src/app/(dashboard)/tasks/[slug]/training/`.

## Data

| Table | Key | Holds |
|---|---|---|
| `train_runs` | `key`, the artifact's served name (`<task>-<snapshot8>-<manifest8>-s<seed>`) | task slug, base, method, status (`running`, `succeeded`, `failed`), manifest, attestation, final metrics, start and finish times |
| `train_metrics` | `(run_key, step, name)` | one logged value per run, step and metric name, with the epoch |

These are separate from the older `training_runs` table, which is tied to task versions and
datasets and is not written by anything yet. A train run does not need the task to be registered
first; its `task_slug` is plain text. Migration: `apps/api/drizzle/0002_train_console.sql`, applied
with `bun run db:migrate` in `apps/api`.

## Endpoints

Writes need `Authorization: Bearer $MODELSTILL_API_TOKEN` or a write API key; reads need any credential (see [auth-and-api-keys](auth-and-api-keys.md)).

| Method and path | Body | Does |
|---|---|---|
| `PUT /v1/tasks/{slug}/train-runs/{key}` | `base`, `method`, `status`, and optionally `manifest`, `attestation`, `finalMetrics`, `startedAt`, `finishedAt` | Creates or updates the run. Fields left out keep their stored value. A run moving out of `running` without `finishedAt` gets the current time. A key already used by another task returns 409. |
| `POST /v1/train-runs/{key}/metrics` | `{"metrics": [{"step", "epoch"?, "name", "value"}]}`, at most 10,000 points | Stores the points. Sending the same `(step, name)` again replaces its value, so retries are safe. Unknown run: 404. |
| `GET /v1/tasks/{slug}/train-runs` | | Runs of the task, newest start first. |
| `GET /v1/train-runs/{key}` | | `{run, series}`, where `series` maps each metric name to its points ordered by step. |

Keys are letters, digits, dots, dashes and underscores, up to 200 characters.

## Push a finished artifact

```bash
export MODELSTILL_API_URL=http://localhost:8787 MODELSTILL_API_TOKEN=...
modelstill push train artifacts/ticket-priority/1a2b3c4d-5e6f7a8b-s1 --task ticket-priority
```

It reads `artifact.json` (base, manifest, metrics; the method comes from the manifest's plan) and
`attestation.json` when present, and marks the run `succeeded`. The finish time is the modification
time of `artifact.json`, and the start time is that minus `train_runtime_s` when the metrics have it.
Then every entry of `log_history.json` that has a `step` becomes points: each finite numeric key
(`loss`, `eval_loss`, `eval_reward`, `learning_rate`, `grad_norm`, runtimes) at that step, with the
entry's `epoch`. Pushing the same artifact again is harmless.

## Report while training

```python
from modelstill.train.console import console_from_env

console = console_from_env(task, key, base, method)
if console:
    console.start(manifest=manifest_dict)
    console.on_log(step, epoch, logs)
    console.finish("succeeded", metrics)
```

`console_from_env` returns `None` without `MODELSTILL_API_TOKEN` and uses a 5 second request timeout,
so a slow API costs a training step at most that long per flush. `on_log` buffers points and posts a
batch when 50 are waiting or 15 seconds have passed since the last post. Nothing it does raises into
training: a failed request adds one to `failures` and keeps the points for the next flush. The
buffer holds at most 20,000 points; past that the oldest are dropped and counted in `dropped`.
`start` and `finish` return whether the API took the update. `finish` flushes first.

## Dashboard

- Task overview: the five newest runs, linking to **Training** in the sidebar for the full list.
- Run page: train loss, eval loss and eval reward charts by step, plus learning rate and gradient
  norm when the run logged them, the run's details, final metrics, manifest and attestation.
- While a run is `running`, its list and run pages refresh every 10 seconds.
