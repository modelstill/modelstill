# 0004. Serve through a Starlette gateway in an optional extra; monitor with canaries and answer hashes

- **Status:** accepted; decision 1 superseded by [ADR 0007](0007-serve-as-a-litellm-plugin.md)
- **Date:** 2026-11-23
- **Deciders:** maintainers

## Context

`modelstill.serve.router` decides between student and cloud, but nothing exposed it over HTTP,
logged its events or watched the models afterwards. The core library must stay light (ADR 0001).
Measured on 2026-11-23 on a LiteLLM proxy: it returns the alias in the response `model` field,
not the upstream model, so a provider change behind the alias cannot be detected from
responses; the same alias gave identical answers to a few hundred prompts at temperature 0 in
two runs.

## Decision

1. The gateway lives in `modelstill.serve.server`, installed only with `modelstill[serve]`,
   pinned to `starlette==1.10.0` and `uvicorn==0.54.0`. Tests use `httpx2==2.16.2` (dev only;
   Starlette 1.10 deprecates `httpx` for its test client). The core CLI loads the server module by
   name, so `pip install modelstill` never imports Starlette.
2. Backends call OpenAI-compatible endpoints through the stdlib `ChatClient` in a worker thread.
   Student confidence defaults to exp(mean token logprob); the rule is a plain function and can be
   swapped per task.
3. Events are written through a bounded in-memory queue in batches; on overflow rows are dropped
   and counted, never blocking an answer.
4. Canary results are stored per item in `modelstill.canary_results` and per run in the new table
   `modelstill.canary_runs` (pass rate, exact interval, floor, paired difference with the last run,
   alerts). Run history for comparisons is kept in JSONL files.
5. Provider drift for cloud aliases is detected by hashing temperature-0 answers to a fixed prompt
   set; any changed answer alerts.
6. Alert webhooks are read from environment variables only.

## Consequences

- Rollout and rollback are edits of a deployment file, re-read every 30 seconds. Since
  [ADR 0021](0021-api-deployment-record-wins.md) they can also be API changes, which win over the
  file while the API answers.
- Log rows can be lost under a ClickHouse outage; `/health` shows how many.
- Streaming is not supported: the router needs the full student answer to decide.
- Drift alarms assume the provider is deterministic at temperature 0. If a provider stops being
  deterministic, the drift check will alarm on every run and needs a tolerance instead.
- Threads for blocking HTTP calls cap concurrency at the default executor size; a high-traffic task
  may need an async HTTP client.

## Alternatives considered

- FastAPI: more dependencies for no feature we need beyond routing and JSON.
- Routing inside LiteLLM: would tie the framework to one proxy and hide the student's logprobs.
- Detecting provider changes from the `model` field: impossible behind an alias (measured above).

## Links

- Runbooks: `../runbooks/serving-and-monitoring.md`
- Code: `python/modelstill/src/modelstill/serve/`, `python/modelstill/src/modelstill/monitor/`,
  `python/modelstill/src/modelstill/sinks.py`, `deploy/clickhouse/schema.sql`
