# 0021. The API deployment record wins over the deployment file while the API answers

- **Status:** accepted
- **Date:** 2026-11-25
- **Deciders:** maintainers

## Context

Until now the LiteLLM plugin read only `deploy/litellm/deployment.<task>.yaml`. The API also keeps
a deployment record per task (`PUT /v1/tasks/{slug}/deployment`, the MCP tool
`set_deployment_mode`, shown on the dashboard), but it did not reach a running proxy, so an operator
had to change two places and the dashboard could disagree with what was served. The record holds
`mode`, `studentModel` (nullable), `threshold`, `shadowSample`, plus `targetError` and `activeFrom`,
which the plugin does not need. No API schema change was required.

## Decision

When `plugin.yaml` has an `api` block (`url`, `token_env` or `token_file`, `timeout`), the plugin
polls `GET /v1/tasks/{task}/deployment` on the same `reload_seconds` as the file, and on the first
call after start. `{task}` is the deployment file's `task` field. On each poll:

1. The API answers with a record: the record is served (`mode`, `threshold`, `shadowSample`, and
   `studentModel`, falling back to the file's `student_model` when the record has none).
2. The API answers with no record for the task: the file is served.
3. The API is unreachable, errors, or returns something that is not a valid deployment: the last
   good deployment is kept, from whichever source; a file edit made during the outage applies.
   The error is shown in `health()` as `api_error`.

Without an `api` block the plugin behaves as before: the file is the only source. Every change from
either source produces a new `deployment_id` in `serving_events`.

`watch check --fallback-deployment`, when the command is connected to the API, sets the API record
to `off` as well as the file, because the record is what a plugin following the API serves.

## Consequences

- An operator changes the mode, threshold or shadow sample from the API, MCP or dashboard, with no
  file edit or restart.
- While the API answers, a file edit is ignored for that task. After an outage the API record wins
  again, so an outage-time file rollback has to be repeated in the API. `serve calibrate` still
  writes the file; with an API record the threshold must also be set in the record.
- The request that triggers a poll waits for it, up to `api.timeout` (default 2 s), once per
  `reload_seconds`.
- `activeFrom` is not interpreted: a record dated in the future applies as soon as the API returns
  it. If scheduled rollouts are needed, the API's read should filter on `activeFrom <= now()`.
- Signal that this stopped holding: deployments diverging from the dashboard, or `api_error`
  persisting in `health()`.

## Alternatives considered

- **File wins, API mirrors it:** keeps the two-place edit that this change removes.
- **Most recent change wins:** needs a comparable timestamp for file edits (mtime is unreliable on
  ConfigMap mounts) and is harder to reason about during an incident.
- **A file `mode: off` always wins (local kill switch):** the shipped bootstrap file is `off`, so the
  API could never turn a task on.
- **On API failure, fall back to the file immediately:** a short API blip would flip a task from
  the API's mode to the file's, possibly from `serve` to `off` and back every 30 s.

## Links

- Runbooks: `../runbooks/serving-and-monitoring.md` ("Changing the mode from the API")
- Code: `python/modelstill/src/modelstill/serve/config.py` (`DeploymentSource`, `api_fetcher`),
  `python/modelstill/src/modelstill/serve/litellm_plugin.py`,
  `python/modelstill/src/modelstill/monitor/api_sink.py` (`rollback`)
- Related: [ADR 0004](0004-gateway-and-monitoring.md), [ADR 0007](0007-serve-as-a-litellm-plugin.md)
