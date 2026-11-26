# Serving and monitoring a task

How to put a trained student behind a task's LiteLLM name, roll it out, roll it back, and watch it
with canaries and drift checks. Code: `python/modelstill/src/modelstill/serve/` and
`python/modelstill/src/modelstill/monitor/`. Decisions: [ADR 0007](../decisions/0007-serve-as-a-litellm-plugin.md)
(serving inside LiteLLM) and [ADR 0004](../decisions/0004-gateway-and-monitoring.md) (monitoring).

## Pieces

| Piece | Where | Needs |
|---|---|---|
| Plugin | a LiteLLM custom provider, loaded by the proxy | `modelstill[litellm]` in the LiteLLM image |
| Threshold | `modelstill serve calibrate calib.jsonl --target-error 0.05 --deployment d.yaml` | core |
| Mode change | the API deployment record (`PUT /v1/tasks/{slug}/deployment`, MCP `set_deployment_mode`) or the deployment file | an `api` block in the plugin config for the API route |
| Canary | `modelstill monitor canary monitor.yaml [--fail-on-alert] [--api URL \| --no-api]` | core (+ task plugins) |
| Drift check | `modelstill monitor drift monitor.yaml [--fail-on-alert] [--api URL \| --no-api]` | core (+ task plugins) |
| Watchdog baseline | `modelstill watch baseline watch.yaml [--replace]` | core (+ task plugins) |
| Watchdog check | `modelstill watch check watch.yaml [--fail-on-alert] [--fallback-deployment d.yaml] [--api URL \| --no-api]` | core (+ task plugins) |

## LiteLLM config

The task keeps its name; only the proxy's config changes. Example files: `deploy/litellm/`.
The examples below use the shipped example task, `ticket-priority`.

```yaml
model_list:
  - model_name: ticket-priority                 # what callers already send
    litellm_params: { model: modelstill/ticket-priority }
    model_info: { input_cost_per_token: 9.1e-8, output_cost_per_token: 1.82e-7 }  # cloud prices
  - model_name: ticket-priority-cloud           # the old ticket-priority deployment, unchanged
    litellm_params: { model: openrouter/deepseek/deepseek-v4-flash, ... }
router_settings:
  fallbacks:
    - ticket-priority: [ticket-priority-fallback]      # plugin or cloud failure
    - ticket-priority-cloud: [ticket-priority-fallback]
litellm_settings:
  custom_provider_map:
    - { provider: modelstill, custom_handler: modelstill_handler.handler }
```

`modelstill_handler.py` sits next to `config.yaml`. `MODELSTILL_LITELLM_CONFIG` names the plugin
config:

```yaml
reload_seconds: 30                     # deployment files and the API record are re-read this often
api:                                   # optional: let the API's deployment record drive the mode
  url: http://modelstill-api:8787
  token_file: secrets/api-token        # a read API key; relative to this file
  token_env: MODELSTILL_PLUGIN_API_KEY # checked first when set
  timeout: 2                           # seconds per poll
tasks:
  ticket-priority:
    deployment: deployment.ticket-priority.yaml  # relative to this file
    confidence: exp_mean_logprob       # or min_token_prob
    student:                           # any OpenAI-compatible server returning logprobs (vLLM)
      base_url: https://student.example.com   # no /v1
      api_key_env: MODELSTILL_STUDENT_KEY
      timeout: 30
    cloud_model: ticket-priority-cloud # a model name in the same proxy
sinks:
  clickhouse: {url: http://clickhouse:8123, user: ms_rw, password_env: MODELSTILL_CLICKHOUSE_PASSWORD}
  jsonl: events.jsonl                  # optional, for local runs
  max_queue: 10000                     # rows beyond this are dropped and counted
  batch_size: 200
  flush_seconds: 1
```

Each call writes one row to `modelstill.serving_events`. In shadow mode the row is written after
the student answers, off the request path. Cache hits in the proxy never reach the plugin, so
they are not logged. The response `model` stays the task name; whoever answered is recorded in the
event row. Streaming is refused.

If the plugin config is missing or broken, the plugin fails only this task's calls, and LiteLLM's
fallback answers them. It never stops the proxy from starting.

## Deployment file and rollout modes

```yaml
task: ticket-priority
mode: shadow            # off | shadow | serve
student_model: ticket-priority-1a2b3c4d-5e6f7a8b-s1   # the name the student server reports; a mismatch defers
threshold: 0.93         # from `serve calibrate`; null means serve mode defers everything
shadow_sample: 1.0      # share of requests also sent to the student in shadow mode
```

1. `off` - the cloud answers everything; prompts are still logged.
2. `shadow` - the cloud answers; a `shadow_sample` share also goes to the student in the
   background and both answers are logged. Compare them before going further.
3. `serve` - the student answers when it is the deployed model and its confidence is at least
   `threshold`; otherwise the cloud answers and both answers are logged (reasons:
   `low_confidence`, `model_mismatch`, `student_error`, `no_threshold`, `no_confidence`).

Edit the file and wait up to `reload_seconds`. The next event rows carry the new
`deployment_id` and `mode`. A file that fails to parse or validate is ignored: the plugin keeps
the last good deployment and logs a warning (`keeps its deployment`).

## Changing the mode from the API

When `plugin.yaml` has an `api` block, the plugin also reads
`GET /v1/tasks/{task}/deployment` every `reload_seconds`, and on the first request after start.
`{task}` is the `task` field of the deployment file. Set the record with
`PUT /v1/tasks/{slug}/deployment`, the MCP tool `set_deployment_mode`, or the dashboard; no file
edit or restart is needed.

Precedence, decided on every poll:

| API state | Deployment served |
|---|---|
| no `api` block in `plugin.yaml` | the file |
| reachable, holds a record for the task | the record: `mode`, `threshold`, `shadowSample`, and `studentModel` (the file's `student_model` when the record has none) |
| reachable, no record for the task | the file |
| unreachable, or the reply is not a valid deployment | the last good deployment, wherever it came from; an edit to the file made during the outage applies |

So the API wins whenever it answers. The file is the bootstrap (what the proxy serves before the
first poll and when the API has no record) and the local fallback during an API outage. A file
edit made while the API answers is ignored for that task; once the API comes back after an outage,
its record wins again, so make the same change there. `serve calibrate` writes the threshold into
the file; when the API holds a record, set the threshold there too (`PUT .../deployment` or
`set_deployment_mode threshold=...`).

The record's `targetError` and `activeFrom` are not used by the plugin. A record with
`activeFrom` in the future is applied as soon as the API returns it.

`health()` shows, per task, `deployment_source` (`file` or `api`), `deployment_error` (the last file
problem) and `api_error` (the last poll problem, cleared on the next good poll). Every change of
mode, threshold, shadow sample or student model, from either source, produces a new `deployment_id`
in `serving_events`. A poll runs in a worker thread; the request that triggers it waits at most
`timeout` seconds.

## Rollback

With an `api` block: set the mode to `off` in the API (`set_deployment_mode mode=off`, or
`PUT /v1/tasks/{slug}/deployment` with `"mode": "off"`). Without one, or while the API is down:
set `mode: off` in the deployment file. Either way, within `reload_seconds` every request is
answered by the cloud. Confirm on the dashboard traffic screen (served by student drops to 0) and in
`health()` (`mode: off`, `deployment_source`). To roll back to an older student instead, set
`student_model` (file) or `studentModel` (API) to its versioned name.

## Calibrating the threshold

Score the student on the calibration split (never the test split) and write one line per item:
`{"confidence": 0.97, "correct": true}`, where confidence is computed
(default `exp_mean_logprob`: exp of the mean token logprob of the answer), the same way the plugin does. Then:

```bash
modelstill serve calibrate calib.jsonl --target-error 0.05 --deployment deployment.ticket-priority.yaml
```

It prints the threshold, the share of requests the student will answer (coverage) and the upper
bound of the error on accepted answers, and writes the threshold into the file. If no cut-off
keeps the error under target, it clears the threshold, so serve mode defers everything.

## Monitor config

```yaml
task: ticket-priority
target: {base_url: http://litellm:4000, model: ticket-priority, api_key_env: MODELSTILL_LITELLM_KEY}
provider: litellm:ticket-priority      # label stored with results; defaults to target.model
request: {ref: messages}               # built-in; or module:attr with args from your own package
params: {temperature: 0, max_tokens: 2000, response_format: {type: json_object}}
state_dir: state                       # previous runs (JSONL); keep it on a persistent volume
clickhouse: {url: http://clickhouse:8123, user: modelstill_writer, password_env: CLICKHOUSE_PASSWORD}
alerts: {log: true, discord_env: MODELSTILL_DISCORD_WEBHOOK}
canary:
  benchmark: canary.jsonl              # Benchmark JSONL with known answers
  limit: 10
  metric: {ref: json_equal}            # built-in; or module:attr with args from your own package
  pass_at: 0.8                         # an item passes when its metric score reaches this
  floor: 0.5
drift:
  prompts: drift.jsonl                 # fixed prompts; only `input` is used
```

Built-ins: request `messages` (input holds `messages`, or is a string); metrics `exact_match`,
`json_equal`. Anything else is `module:attribute`, called with `args` when given.

- Canary: pass rate with an exact Clopper-Pearson interval, one row per item in
  `modelstill.canary_results` and one per run in `modelstill.canary_runs`, plus JSONL copies in
  `state_dir`. Alerts: `canary_below_floor` when the interval's upper bound is below `floor`;
  `canary_regression` when the paired comparison with the previous run on the same items says
  `worse`.
- Drift: answers to the fixed prompts at temperature 0 (forced) are hashed and compared with the
  previous run. Any changed answer raises `provider_drift`. A LiteLLM alias reports the alias,
  not the upstream model, in `model`, so this hash is the only way to see a provider swap. Failed
  calls are listed but never counted as changes.

Exit codes: 0 done, 1 config or store error, 2 an alert fired and `--fail-on-alert` was given.
The Discord webhook URL comes only from the environment variable named in `discord_env`; if it is
named but unset, the command fails before calling the target.

## Sending results to the dashboard

`monitor canary`, `monitor drift` and `watch check` also push to the API, which fills the
dashboard's Monitoring page (`GET /v1/tasks/{slug}/canaries` and `/alerts`):

- on when both `MODELSTILL_API_URL` and `MODELSTILL_API_TOKEN` are set (a write API key or the admin
  token), or with `--api URL` (then `MODELSTILL_API_TOKEN` is required, and its absence fails
  before any call);
- `--no-api` keeps a run local even when the variables are set.

What is sent, to the task named by the config's `task` (register it first with `push task`):

| Run | API record |
|---|---|
| `monitor canary` | one canary run (`POST /v1/tasks/{slug}/canaries`): provider, passed, total and the Clopper-Pearson interval; its id is the run id |
| `watch check` with a `canary` section | one canary run from the check's canary fields |
| every alert from canary, drift and watch | one alert each (`POST /v1/tasks/{slug}/alerts`): `kind`, `severity` (the alert level), and `payload` with `message` and `details` |

A drift check or watch check that fires nothing leaves no API record: the API has canary and alert
tables only, and the full rows stay in ClickHouse and `state_dir`.

Records are sent once per run, at the end, in batches of up to 500 per kind. The push is best
effort: an unreachable API, a 4xx/5xx or a timeout (10 s) never changes the exit code or the
printed result. Unsent records go to `state_dir/api-outbox.jsonl` (newest 5000 kept) and are sent
first on the next run. Every record carries an id, so a resend never duplicates it. The outcome is
printed on stderr: `sent N records to the API`, or how many were kept and why.

With an API configured, `watch check --fallback-deployment d.yaml` also turns the task's API
deployment record off on a critical alert (keeping its student model, threshold, target error and
shadow sample), because the plugin follows the API record when it has one. If the API holds no
record, only the file changes. The result is printed on stderr; a failed API rollback is reported
there and does not stop the run, so check it and set the mode off by hand if it failed.

## Endpoint watchdog

`modelstill watch` catches a silent change behind a model name (a LiteLLM alias or a provider
model): on the day the endpoint is approved it records a baseline, and every later check is
compared with that baseline, not with the previous run, so a slow drift cannot hide. It follows
Log Probability Tracking of LLM APIs (arXiv 2512.03816).
The config is a monitor config with a `watch` section; `canary` is optional and is scored against
the baseline when present.

```yaml
task: ticket-priority
target: {base_url: http://litellm:4000, model: ticket-priority, api_key_env: MODELSTILL_LITELLM_KEY}
state_dir: state                       # baselines and checks; keep it on a persistent volume
alerts: {log: true, discord_env: MODELSTILL_DISCORD_WEBHOOK}
canary: {benchmark: canary.jsonl, floor: 0.5}
watch:
  prompts: watch.jsonl                 # fixed prompts, Benchmark JSONL; only `input` is used
  limit: 30
  repeats: 2                           # baseline samples per prompt, at least 2
  logprobs: true
  top_logprobs: 5                      # 0 asks for the chosen tokens only
  max_tokens: 16
  alpha: 0.01
  critical_shift: 0.25                 # nats of excess shift that make a shift critical
  max_changed: 0.1                     # share of stable prompts whose answer may change before warn
  rounds: 10000
```

```bash
modelstill watch baseline watch.yaml            # on approval day; --replace to re-approve
modelstill watch check watch.yaml --fail-on-alert --fallback-deployment deployment.yaml
```

The baseline lives in `state_dir/watch-baseline.<task>.<provider>.json`; it is never replaced
without `--replace`. Each check appends its per-prompt detail to `state_dir/watch-checks.jsonl`
and one row to `modelstill.watch_runs` (ClickHouse when configured, JSONL in `state_dir` always).
A changed prompt file or canary benchmark refuses to check: record a new baseline.

What a check measures, with every threshold stored in the row:

- Canary: pass rate with an exact Clopper-Pearson interval, the paired difference from the
  baseline with a bootstrap interval, and an exact one-sided McNemar test (binomial on the items
  that broke against those that got fixed). With 10 items, 7 broken and none fixed is the
  smallest regression that reaches p < 0.01.
- Answers: prompts are sent at temperature 0 with `max_tokens`, `logprobs` and `top_logprobs`.
  An answer counts as changed when its hash matches none of the baseline samples. A prompt is
  stable when its baseline samples agreed.
- Log-probs: for each prompt, the distance between two token lists is the mean absolute
  log-prob difference over tokens present in both top-k lists, position by position, up to and
  including the first position where the chosen tokens differ (later positions have a different
  context). `shift` is the distance from baseline sample 1 to today; `noise` is the distance from
  baseline sample 1 to baseline sample 2, the provider's own nondeterminism. Under no change the
  two are exchangeable, so a one-sided sign-flip permutation test on `shift - noise` is valid
  however noisy the provider is: exact over every sign pattern while 2^n fits in `rounds`, Monte
  Carlo with a seed otherwise. `logprob_excess` is the mean of `shift - noise` with a bootstrap
  interval. With a deterministic provider, 7 prompts is the fewest that can reach p < 0.01.
  Providers that return no log-probs are compared on hashes alone (`logprob_p` is null).

Alerts carry a level and go through the same sinks as the canary:

| Alert | Level |
|---|---|
| `watch_canary_below_floor`: interval upper bound below `floor` | critical |
| `watch_canary_regression`: McNemar p < `alpha` and more broke than got fixed | critical |
| `watch_logprob_shift`: sign-flip p < `alpha` | warn; critical when the excess reaches `critical_shift` |
| `watch_answers_changed`: share of stable prompts with a new answer above `max_changed` | warn; info below it |
| `watch_served_model_changed`: the reply's `model` was not seen at baseline | warn |
| `watch_fallback`: `--fallback-deployment` set the file to `mode: off` | critical |

The row's `level` is the highest level fired, or `ok`. `--fail-on-alert` exits 2 on warn or
critical, not on info. `--fallback-deployment` writes `mode: off` atomically, keeping every other
setting, only on critical; the plugin picks it up within 30 s (with an API configured, the API
record is set off as well, see above). The defaults for `alpha`,
`critical_shift` and `max_changed` are starting points, not measured values; revisit them after
the first month of checks on your own aliases.

## Running on a schedule

A Kubernetes CronJob, one per task (hourly canary, daily drift is a reasonable start):

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: {name: ticket-priority-canary}
spec:
  schedule: "17 * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: canary
              image: <modelstill image>
              args: ["modelstill", "monitor", "canary", "/config/monitor.yaml"]
              envFrom: [{secretRef: {name: modelstill-monitor}}]   # LITELLM key, webhook, CH password
              volumeMounts: [{name: state, mountPath: /config/state}]
```

Each canary run costs `limit` calls to the target; each drift check costs one call per prompt.
A watch baseline costs the canary plus `repeats` calls per prompt; a watch check costs the canary
plus one call per prompt. A daily watch check next to the hourly canary is a reasonable start.

## Local end-to-end check

A real proxy with the plugin, a mocked cloud model and no GPU:

```bash
uv venv && uv pip install "litellm[proxy]==1.101.0"
uv pip install --no-deps python/modelstill/dist/modelstill-0.1.0-py3-none-any.whl
cp deploy/litellm/{modelstill_handler.py,plugin.yaml,deployment.technographics.yaml} <dir>/
# the shipped example files name their task `technographics`
# in <dir>/config.yaml give technographics-cloud `mock_response: '{"technologies": []}'`
MODELSTILL_LITELLM_CONFIG=<dir>/plugin.yaml litellm --config <dir>/config.yaml --port 14999
curl -s localhost:14999/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model": "technographics", "messages": [{"role": "user", "content": "Python"}]}'
```

The `x-litellm-response-cost` header shows that the call was priced, and each request adds a row to the
sink.

## Notes moved from code

- `deploy/litellm/Dockerfile`: the plugin needs only pydantic and PyYAML, which the proxy already
  ships, so the wheel is installed with `--no-deps` and nothing else in the image changes. Build the
  wheel first: `uv build --wheel` in `python/modelstill`.
- The deployment file (`deploy/litellm/deployment.technographics.yaml` in the shipped example) is
  edited live; the plugin re-reads it every 30 s.
  Roll out `off` -> `shadow` -> `serve`; set `off` to roll back. A deployment file is replaced
  atomically when written, and a broken edit keeps the last good deployment and reports the error
  in `health()`. With an `api` block in `plugin.yaml`, the API record wins over this file while
  the API answers (see "Changing the mode from the API").
- `serve/config.py` (`DeploymentSource`): any failure while polling the API (network, HTTP status,
  bad JSON, an invalid record) keeps the last good deployment, so one bad poll can never change
  what is served (the `BLE001` suppression). The poll timeout defaults to 2 s because the request
  that triggers a poll waits for it.
- `monitor/api_sink.py`: pushing to the API must never fail a canary or watch run, so every push
  error is caught (`BLE001`) and the records are kept in an outbox for the next run.
- `deploy/litellm/plugin.yaml` is the file `MODELSTILL_LITELLM_CONFIG` names; relative paths in it
  are relative to the file.
- `serve/litellm_plugin.py`: the config is read on first use, not at import, so a missing or broken
  config fails only this task's calls, which then go to LiteLLM's fallback. A served student answer
  is priced at cloud prices, which overstates spend and never hides it. Usage is set with `setattr`
  (the `B010` suppression) because `ModelResponse` declares no usage field and LiteLLM reads the
  attribute.
- `python/modelstill/pyproject.toml`: pytest ignores one pydantic `UserWarning` ("Item 'summary' on
  TypedDict class 'ChatCompletionReasoningItem'") because litellm 1.101.0's own response types
  trip it on first use.
- `serve/backends.py`: student confidence is exp(mean token logprob). It needs only
  `logprobs: true`, does not shrink with answer length as the joint probability does, and the
  threshold is calibrated on the same number, so only its ranking matters. JSON answers have many
  near-certain punctuation tokens that can hide one unsure token, which `min_token_prob` looks at
  instead. Streaming is not forwarded: the router needs the whole answer to decide.
- `serve/router.py`: any student failure falls back to the cloud and never fails the request (the
  `BLE001` suppression).
- `sinks.py`: a bounded queue sits in front of every writer; when it is full a row is dropped and
  counted, because losing a log row is cheaper than delaying an answer. The drop count is on
  `/health`. A store outage never stops the flush loop (`BLE001`), and the final write is shielded
  so a shutdown waits for it instead of losing the batch.
- `monitor/canary.py`: a cloud alias hides which model answers, so drift is detected by hashing
  temperature-0 answers to a fixed prompt set; failed calls are left out rather than counted as
  changes. One broken alert sink must not silence the rest (`BLE001`).
- `monitor/watch.py`: the log-prob test compares today against the baseline's own repeat, not
  against zero, because some providers are not deterministic at temperature 0; a fixed tolerance
  would either miss small swaps on deterministic endpoints or fire daily on noisy ones.
- `monitor/alerts.py`: the Discord webhook URL is a secret, read only from an environment variable;
  a configured but unset variable fails at start, not silently at alert time.
