# Ingest traces and import other tools' eval results

How to turn what a team already records into ModelStill data. There are three ways in:
- `modelstill ingest`: read traces and logs into a dataset.
- `modelstill import`: record another tool's eval results as History runs, then compare and gate
  them.
- The pytest plugin: record a pytest session as a run and gate it.

Code: `python/modelstill/src/modelstill/ingest/` and
`python/modelstill/src/modelstill/pytest_plugin.py`. Decision:
[ADR 0016](../decisions/0016-ai-quality-platform.md) (build on Langfuse and OpenTelemetry, do not
build a trace store, do not rebuild other tools' metrics).

## Pieces

| Piece | Command | Needs |
|---|---|---|
| Langfuse generations | `modelstill ingest langfuse --from ... --out dataset.jsonl` | core, read keys |
| OpenTelemetry GenAI spans | `modelstill ingest otel traces.json --out dataset.jsonl` | core |
| LiteLLM spend logs | `modelstill ingest litellm spend.csv --out dataset.jsonl` | core |
| Any JSONL | `modelstill ingest jsonl rows.jsonl --input ... --out dataset.jsonl` | core |
| Braintrust logs or dataset | `modelstill ingest braintrust [export] [--project-id\|--dataset-id] --out dataset.jsonl` | core, API key for the API |
| Braintrust experiment | `modelstill import braintrust [export] [--experiment-id] --history runs.jsonl --task <slug>` | core, API key for the API |
| DeepEval results | `modelstill import deepeval run.json --history runs.jsonl --task <slug>` | core |
| Inspect logs | `modelstill import inspect log.eval --history runs.jsonl --task <slug>` | core |
| Promptfoo results | `modelstill import promptfoo out.json --history runs.jsonl --task <slug>` | core |
| pytest plugin | `pytest --modelstill-history runs.jsonl [--modelstill-gate spec.yaml]` | `modelstill[pytest]` |

Nothing here needs a new required dependency. Network reads use the standard library.

## Ingest: traces and logs into a dataset

Every source becomes `DatasetItem` rows (`modelstill.data`) in the dataset JSONL given by `--out`:
- `input`: the prompt, as chat messages when the source has them;
- `provenance`: the source name, the source's own ids and the builder module;
- `outputs`: the answer keyed by the model that gave it, or an error.

Rows with the same input are merged into one item, so answers from different models line up for
labelling and comparison. Running an ingest again merges new answers into items already in the
file. The command prints how many records it read, how many items they made and how many were new
or changed.

### Langfuse

```bash
export LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=...   # the project's API keys
export LANGFUSE_HOST=https://langfuse.example.com         # or pass --host
modelstill ingest langfuse --from 2026-11-01T00:00:00Z --to 2026-11-24T00:00:00Z \
  --name ticket-priority --out tasks/ticket-priority/data/langfuse.jsonl
```

- The reader only sends `GET` requests to the public API. Keep the keys in the secret store and
  pass them through the environment, never on the command line.
- The default is `GET /api/public/v2/observations` (cursor pagination, `fields=core,basic,io,model`).
  The reader keeps asking until `meta.cursor` is absent, because v2 may return empty pages that
  still carry a cursor.
- Self-hosted Langfuse older than v2 observations: pass `--api v1` to use
  `GET /api/public/observations` with page numbers until `meta.totalPages`.
- `--type` defaults to `GENERATION`. `--name` narrows to one observation name.
- `--from` maps to `fromStartTime` and `--to` to `toStartTime`.
- Each output is keyed by the observation's `model`. If that is empty, the key is
  `langfuse:<name>`.
- An observation at level `ERROR` becomes an error output with its `statusMessage`.
- `input` and `output` arrive as raw strings in v2 and are parsed as JSON when they are JSON.
- Provenance keys are `trace_id` and `observation_id`.

### Braintrust

```bash
modelstill ingest braintrust logs.json --out dataset.jsonl            # an export file
export BRAINTRUST_API_KEY=...                                          # the org's API key
modelstill ingest braintrust --project-id <project-uuid> --out dataset.jsonl
modelstill ingest braintrust --dataset-id <dataset-uuid> --out dataset.jsonl --cases golden.jsonl
```

- **Sources:** give exactly one of an export file, `--project-id` (project logs) or
  `--dataset-id`.
- **Export files:** a JSON array of rows, a fetch response (`{"events": [...]}`), a SQL `/btql`
  JSON response (`{"data": [...]}`), JSON lines (`/btql` with `fmt: jsonl`, or the cloud-storage
  export), or any of them gzipped (`.jsonl.gz`). A row id that appears more than once keeps its
  highest `_xact_id`; rows marked `_object_delete` are dropped.
- **API:** `POST /v1/project_logs/{id}/fetch` or `POST /v1/dataset/{id}/fetch` with
  `Authorization: Bearer $BRAINTRUST_API_KEY` and a body of `{"limit", "cursor"}`. The reader sends
  the previous page's `cursor` until a page is empty or has no cursor. Pages run from latest to
  earliest and may repeat an older version of a row already read, so only the first copy of each
  `id` is kept. `--api-url` or `$BRAINTRUST_API_URL` changes the host (default
  `https://api.braintrust.dev`; `https://api-eu.braintrust.dev` for the EU data plane, or your
  own data plane URL). `--page-size` is the fetch `limit`, which counts traces, not rows.
- **Which rows:** root spans by default (`is_root`, else no `span_parents`, else
  `span_id == root_span_id`). `--span-type llm` takes every span of that `span_attributes.type`
  instead, for example the LLM calls inside a task trace.
- **Output key:** `metadata.model`, else `braintrust:<span_attributes.name>`.
- **Answer:** `output`; an OpenAI-style `choices` list gives its first message. A non-empty `error`
  becomes an error output. Dataset rows have no output, so they record inputs only.
- **Benchmark cases:** `--cases golden.jsonl` also writes every root row with an `expected` value
  as a benchmark case (`id`, `input`, `expected`, `tags`), replacing that file.
- **Provenance keys:** `id`, `span_id` and `root_span_id`.

### OpenTelemetry GenAI spans

`modelstill ingest otel traces.json --out dataset.jsonl` reads an OTLP JSON export. That is either
one `ExportTraceServiceRequest` object, or the collector file exporter's JSON lines (one object
per line).

A span counts when it has any `gen_ai.*` attribute. The input is read from the first of these that
is present:
1. `gen_ai.input.messages`, with `gen_ai.system_instructions` prepended as a system message. This
   is the current convention.
2. The indexed `gen_ai.prompt.<n>.role/content` attributes, as written by OpenLLMetry and older
   instrumentations.
3. The `gen_ai.content.prompt` span event's `gen_ai.prompt` attribute.

The answer comes from `gen_ai.output.messages` (the first choice), `gen_ai.completion.0.content`,
or the `gen_ai.content.completion` event.

Message parts that are all text are flattened to `{"role", "content"}`. Tool calls and other parts
are kept as they are.

The output key is `gen_ai.response.model` (the model that actually answered), falling back to
`gen_ai.request.model`. A span with status `ERROR` becomes an error output.

### LiteLLM spend logs

`modelstill ingest litellm spend.csv --out dataset.jsonl` reads `LiteLLM_SpendLogs` rows. It takes
a CSV export, a JSON array, a JSON object with `data` or `logs`, or JSON lines.

- **Prompts:** LiteLLM stores them only when `general_settings.store_prompts_in_spend_logs` is
  true. The request is read from `proxy_server_request.messages` (or `input`/`prompt`), then from
  the `messages` column. Rows without a prompt are skipped.
- **Answers:** the answer is `response.choices[0].message.content`.
- **Errors:** rows with `status: failure` become errors, using
  `metadata.error_information.error_message`.
- **Model key:** outputs are keyed by `model`, the deployment that answered. Use
  `--model-field model_group` to key them by the public alias instead.

### Any JSONL

```bash
modelstill ingest jsonl calls.jsonl --input request.messages --output response.text \
  --model-field response.model --id-field id --error-field error --out dataset.jsonl
```

- Fields are dotted paths.
- `--input a.text,a.lang` builds the object `{"text": ..., "lang": ...}`.
- `--model NAME` names one model for every row instead of `--model-field`. Give exactly one of
  them when `--output` is set.
- Without `--output`, only inputs are recorded (for labelling later).

## Import: other tools' results as runs

```bash
modelstill import deepeval .deepeval/.latest_run_full.json --history runs.jsonl --task ticket-priority --accept
modelstill import deepeval results/test_run_20261124_101500.json --history runs.jsonl \
  --task ticket-priority --model candidate \
  --gate tasks/ticket-priority/spec.yaml --flip-rate 0 --cost-ratio 1
modelstill eval compare runs.jsonl <baseline> <candidate>
```

Each file becomes one run in the History file, or one run per column for Promptfoo. The run's
benchmark is `--task` plus the imported cases. Two files over the same cases get the same benchmark
version, so `modelstill eval compare` pairs them case by case and the gate finds the accepted
baseline. Each case's score is the tool's own verdict: ModelStill does not re-score anything.
Intervals come from ModelStill:
- Clopper-Pearson for pass/fail scores;
- the bootstrap for fractional scores;
- per-metric intervals for every other score the file carries.

| Tool | Case | Case score | Other metrics |
|---|---|---|---|
| DeepEval | test case `name` | `success` (1 or 0) | each `metricsData[].score` |
| Inspect | sample `id` | the scorer's value, mean over epochs | other scorers, `scorer.key` for dict values |
| Promptfoo | `testCase.description`, else `test-<testIdx>` | `success`, mean over repeats | `score` and each `namedScores` |
| Braintrust | `origin.id` (the dataset row), else a hash of `input` | the `--scorer` score, mean over trials | every other `scores` entry |

Format notes:
- **DeepEval** reads the `TestRun` JSON:
  - `test_run_<timestamp>.json` from `DEEPEVAL_RESULTS_FOLDER`;
  - `.deepeval/.latest_run_full.json`;
  - `.deepeval/.temp_test_run_data.json`;
  - `.deepeval/.latest_test_run.json`, which wraps the run under `testRunData`.

  Test cases that no metric ran on (`success` missing) are left out. A metric error makes the case
  fail with that error. Conversational test cases keep their turns as the input. Latency is
  `completionTime`. The model name is `hyperparameters.model`, unless `--model` is given.
- **Inspect** reads both log formats. `.eval` is a zip: it holds `header.json`, or
  `_journal/start.json` while the run is still going, plus `samples/*.json`. `.json` is the whole
  `EvalLog`.
  - **Scorer:** the first scorer in `results.scores` is the case score unless `--scorer name` or
    `--scorer name.key` is given.
  - **Values:** they map to numbers as Inspect's `value_to_float` does: C 1, I 0, P 0.5, N 0,
    yes/true 1, no/false 0, numeric strings as numbers. NaN (excluded) values are skipped.
  - **Errors:** an errored epoch with no score counts as 0.
  - **Epochs:** they are averaged into one case, so repeated runs of one sample count as one
    independent sample.
  - **Model and latency:** the model is `eval.model`. Latency is the mean `total_time`.
- **Promptfoo** reads the `--output results.json` file (`OutputFile` with an `EvaluateSummaryV3`
  or V2 summary) or a bare summary. Each `promptIdx` column (a provider and prompt pair) becomes
  its own run, named by the provider label or id. A provider with several prompts gets the prompt
  label appended. `--provider` keeps one column. Repeats (`repeatIndex`) are averaged into one
  case. Latency is `latencyMs`.
- **Braintrust** reads an experiment export (same file shapes as the ingest above) or fetches one
  with `--experiment-id` (`POST /v1/experiment/{id}/fetch`, `BRAINTRUST_API_KEY`). Only root spans
  count, so score and LLM subspans are skipped.
  - **Scorer:** with one score name in the experiment it is the case score. With several,
    `--scorer` is required and the error lists the names.
  - **Cases:** rows that came from the same dataset row (`origin.id`) are trials of one case and are
    averaged. Two experiments over the same dataset therefore pair case by case. Rows without an
    origin are keyed by a hash of their input.
  - **Errors:** an errored row with no score counts as 0. A row with neither is skipped.
  - **Model and latency:** the model is `metadata.model` unless `--model` is given. Latency is
    `metrics.end - metrics.start`.

If two cases in a file share a name, the case ids fall back to `name:<hash of input and expected>`.

### Gating an import

`--gate` takes a task spec (its `eval.gate`), a YAML file with a `gate:` key, or a bare gate. It
decides against the latest accepted run of the same benchmark version and stores the decision in
the History file (a `kind: gate` row with every threshold and measured value). The command exits
1 when any gate fails.

- **Flip rate and cost ratio:** eval files do not measure them, so `--gate` requires
  `--flip-rate` and `--cost-ratio`. An unmeasured check is never recorded as passing (see the
  release gate rules in the bundled skill). For a prompt change on the same model, the honest
  values are usually `--flip-rate 0 --cost-ratio 1`.
- **p95 latency:** it is measured from the file's latencies. Pass `--p95-latency-ms` when the file
  has none.
- **Regression gate:** a gate with `max_regression` needs an accepted baseline. Import the
  baseline once with `--accept` (or run `modelstill eval accept runs.jsonl <run>`).
- **`--accept` with `--gate`:** the run is accepted only when its gate passes.

## pytest plugin

`pip install modelstill[pytest]` registers the plugin through the `pytest11` entry point. It does
nothing until `--modelstill-history` is given.

```python
import pytest


@pytest.mark.modelstill_cases("golden.jsonl")
def test_sets_priority(case, modelstill_score):
    answer = classify(case.input)
    modelstill_score.record(1.0 if answer == case.expected else 0.0, output=answer)


@pytest.mark.modelstill
def test_empty_ticket_is_low():
    assert classify("") == {"priority": "low"}
```

- **`modelstill_cases(path, argname="case")`** runs the test once per benchmark case, using a
  benchmark JSONL with `id`, `input`, `expected` and `tags`. The path is relative to the test
  file, then to the rootdir. The case id is the benchmark id.
- **`modelstill`** marks a plain test as a case. Its id is the test node id, and a pass scores 1.
- **The `modelstill_score` fixture** records a score from 0 to 1, the output and any named metrics.
  A test that fails scores 0, whatever it recorded. To keep graded cases from failing the session
  on their own, record a score instead of asserting.
- **Latency:** each case's latency is its call duration.

```bash
pytest --modelstill-history runs.jsonl --modelstill-task ticket-priority --modelstill-model gpt-5-mini
modelstill eval accept runs.jsonl <run>      # once, to set the baseline
pytest --modelstill-history runs.jsonl --modelstill-task ticket-priority --modelstill-model candidate \
  --modelstill-gate tasks/ticket-priority/spec.yaml --modelstill-flip-rate 0 --modelstill-cost-ratio 1
```

- **Recording:** at the end of the session the plugin records one run and prints it under a
  `modelstill` section.
- **Gate:** with `--modelstill-gate` it also gates the run against the accepted baseline. A failed
  gate, or a regression gate with no baseline, makes the session exit 1.
- **Unmeasured checks:** `--modelstill-gate` without `--modelstill-flip-rate` and
  `--modelstill-cost-ratio` is a usage error, for the same reason as `import --gate`.
- **Task name:** `--modelstill-task` defaults to the rootdir name.

## Format versions checked

These were read from each project's own source on 24 Nov 2026:

| Source | Version read | Files |
|---|---|---|
| Langfuse public API | main at 4.84.0; v1 observations at v3.100.0 | `fern/apis/server/definition/observations.yml`, `utils/pagination.yml` |
| OpenTelemetry GenAI | `semantic-conventions-genai` main (v0.1.0); `semantic-conventions` v1.45.0 for the deprecated attributes | `model/gen-ai/registry.yaml` |
| LiteLLM | 1.101.0 (the pinned version) | `proxy/schema.prisma` (`LiteLLM_SpendLogs`), `proxy/spend_tracking/spend_tracking_utils.py` |
| DeepEval | main at 4.3.5 (release python-v4.2.4) | `deepeval/test_run/test_run.py`, `test_run/api.py`, `evaluate/local_store.py`, `tracing/api.py` |
| Inspect | main at 0.3.292 | `log/_log.py`, `log/_recorders/eval.py`, `scorer/_metric.py`, `model/_model_output.py` |
| Promptfoo | main at 0.126.0 | `src/types/index.ts` (`OutputFile`, `EvaluateSummaryV3`, `EvaluateResult`) |
| Braintrust REST API (read 25 Nov 2026) | `braintrustdata/braintrust-openapi` main, `openapi/spec.json` 1.0.0 | `FetchEventsRequest`, `FetchProjectLogsEventsResponse`, `ProjectLogsEvent`, `DatasetEvent`, `ExperimentEvent`; docs pages `api-reference/query`, `admin/data-management/export` |

The Braintrust fixtures were written from those schemas, not from a real export: no Braintrust
account with data was used. Replace them with a real export when one is available.

When a tool changes its format, add a fixture under `python/modelstill/tests/fixtures/ingest/` from
a real export first, then change the reader.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401: ...` from `ingest langfuse` | wrong keys or host | check `LANGFUSE_HOST` and the project's key pair |
| `400` mentioning `parseIoAsJson` or unknown path | old self-hosted Langfuse | `--api v1` |
| `read 0 records` from LiteLLM | prompts not stored | set `store_prompts_in_spend_logs: true` in the proxy's `general_settings` |
| `both runs must score the same cases` | the candidate file has different cases from the baseline | rerun the eval on the same dataset |
| `no accepted baseline` | the gate has `max_regression` and nothing is accepted for this benchmark version | import a baseline with `--accept` |
| `scorer 'x' gives several values` | an Inspect scorer returns a dict | `--scorer x.<key>` |
| `the experiment has several scores; pick one` | a Braintrust experiment with more than one scorer | `--scorer <name>` from the listed names |
| `401: ...` from a Braintrust command | wrong key or data plane | check `BRAINTRUST_API_KEY` and `--api-url` |
| `give one of an export file, --project-id, --dataset-id` | none or several sources | pass exactly one |
