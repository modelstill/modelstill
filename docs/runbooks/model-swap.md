# Model or provider swap

How to decide, with one command and no gold set, whether a task should move to another model or
provider. Code: `python/modelstill/src/modelstill/swap.py`. Decision:
[ADR 0016](../decisions/0016-ai-quality-platform.md).

## When to use it

- A provider deprecates or reprices the model behind a LiteLLM alias.
- A cheaper model, or the same model on another provider or precision, is on offer.
- The question is "does the candidate answer like the model we run today?", not "is it right?".
  Correctness against a gold set is the release gate's job (`modelstill push gate`).

## Inputs

- **Spec:** `tasks/<task>/spec.yaml`. It supplies the system prompt (`instruction`), the agreement
  metric (the gate metric's requirement type), the margin (`eval.gate.max_regression`) and the
  LiteLLM alias (`serve.litellm_alias`). The shipped example is `tasks/ticket-priority/spec.yaml`.
- **Records:** a dataset JSONL of `DatasetItem` rows, for example the file `modelstill ingest`
  writes, or one written by an adapter package for your application. The recorded answer under the
  `production` output is used only for the extra "agreement with recorded" figure.
- **Messages:** an input that holds `messages` is sent as is. Any other input becomes
  `[system: instruction, user: input as text or JSON]`. A task with its own layout passes
  `--prompt module:attr`, a function `(system, input) -> messages` from your own package.
- **Endpoint:** `--base-url` is any OpenAI-compatible URL, normally the LiteLLM proxy. The key is
  read from the environment variable named by `--api-key-env` (default `LITELLM_API_KEY`).

## Run it

```bash
export LITELLM_API_KEY=...   # from your secret store
modelstill swap tasks/ticket-priority/spec.yaml \
  --records data/ticket-priority/dataset.jsonl \
  --current deepseek/deepseek-v4-flash \
  --candidate qwen/qwen3.7-flash \
  --candidate qwen/qwen3.7-flash@http://vllm-host:8000 \
  --base-url http://litellm:4000 \
  --sample 300 --repeats 2 \
  --litellm-config litellm-config.yaml \
  --history runs/swap-history.jsonl --out runs/swap-ticket-priority.json
```

With `--out` the command prints a short summary and the LiteLLM change, and writes the full JSON
report to the file. Without it, the JSON report goes to stdout.

Calls made: `sample x (repeats + number of candidates)`. 300 records, 2 repeats and 2 candidates is
1,200 calls.

## What it measures

1. The current model answers every record `--repeats` times (at least 2) at `--temperature`
   (default 0). Its first answers are the reference.
2. **Noise floor:** each later run of the current model is scored against the reference. With two
   repeats this is one 0/1 score per record for exact and JSON metrics.
3. **Agreement:** each candidate answers once and is scored against the same reference with the
   same metric, so the candidate and the noise floor are paired record by record.
4. **Gap:** `evals.compare(noise floor, candidate)`, a paired bootstrap of per-record differences
   (2,000 rounds, seed 0), with `fixed` and `broken` counts.

Intervals follow `AGENTS.md`: 0/1 scores get an exact Clopper-Pearson interval; fractional scores
(set F1, or more than two repeats) get a bootstrap interval.

**Metrics** (`--metric`, default from the spec):
- `set_f1`: both answers parsed as JSON. A list, or the one list inside an object such as
  `{"tags": [...]}`, is compared as a set of canonical JSON items.
- `json`: parsed JSON equality, so key order and spacing do not count. The default for `exact`,
  `label` and `pass_fail` requirements, since every spec has a JSON output schema.
- `exact`: text equality after trimming outer whitespace.
- `module:attr`: any `(output, reference) -> float` in `[0, 1]`.

**Unreadable answers:** an HTTP or transport error, an empty answer, or (for `json` and `set_f1`)
an answer that is not JSON. It scores 0 and counts in the endpoint's unreadable rate, which carries
an exact interval. A record whose reference is unreadable scores 0 for the noise floor and every
candidate alike, so it does not move the gap.

**Cost:** cost per 1,000 calls = 1,000 x the mean over answered calls of
`prompt_tokens x input_cost_per_token + completion_tokens x output_cost_per_token`, using the usage
the endpoint returns. Prices come from `model_info` in `--litellm-config`, then from `--prices`,
a small YAML file:

```yaml
deepseek/deepseek-v4-flash: {input_cost_per_token: 9.1e-8, output_cost_per_token: 1.82e-7}
qwen/qwen3.7-flash@http://vllm-host:8000: {input_cost_per_token: 0, output_cost_per_token: 0}
```

An endpoint is looked up by its full label (`model@url`) first, then by model. `--prices` may also
point at a LiteLLM config. With no price, cost and cost ratio are `null`.

**Latency:** wall time of each answered call, reported as nearest-rank p50 and p95 in ms.

## The decision

The margin is `--margin`, else the spec's `eval.gate.max_regression`, else 0.02. For each
candidate:

| Check | Threshold | Measured |
|---|---|---|
| `agreement_gap_lower_bound` | `-margin` | lower bound of the gap |
| `agreement_gap_upper_bound` | `-margin` | upper bound of the gap |
| `cost_ratio` (with `--max-cost-ratio`) | the limit | candidate / current cost per 1,000 calls |
| `p95_latency_ms` (with `--max-p95-latency-ms`) | the limit | candidate p95 |

- `do_not_switch`: the gap's upper bound is below `-margin` (the candidate is surely worse than the
  noise floor by more than the margin), or a cost or latency limit fails. An unmeasured cost or
  latency is recorded as infinite, so it fails.
- `switch`: the gap's lower bound is at least `-margin` and every limit holds.
- `inconclusive`: anything else. Replay more records (`--sample`) and run again.

The run's `decision` is `switch` if any candidate switches, else `inconclusive` if any is
inconclusive, else `do_not_switch`. `choice` is the switching candidate with the lowest cost per
1,000 calls (unpriced last), ties broken by higher agreement. Every check is stored in the report
with its threshold and measured value.

## The LiteLLM change

For the choice the report holds `litellm.before`, `litellm.after` and `litellm.yaml`, the
`model_list` entry for the alias (`--alias`, default the spec's `serve.litellm_alias`):

- A candidate at `--base-url` that names a `model_name` in `--litellm-config` takes that entry's
  `litellm_params` and `model_info` as they are.
- A candidate at its own URL becomes `model: openai/<model>`, `api_base: <url>` and
  `api_key: os.environ/<api-key-env>`.
- Otherwise `model: <candidate>`.

`before` is the alias's current `litellm_params` from the config, or `{model: <current>}`. Apply
the change in the proxy config, keep the old entry for rollback, and reload the proxy.

## Recorded mode: no calls to the current model

`--current recorded` uses each record's stored answer as the current model's answer and never
calls the current model. `--current recorded:<teacher-key>` picks another output key (default
`production`). Use it when there is no budget for the cloud model, or to measure how closely a
student copies production.

```bash
modelstill swap tasks/ticket-priority/spec.yaml \
  --records data/ticket-priority/dataset.jsonl \
  --current recorded \
  --candidate ticket-priority-1a2b3c4d-5e6f7a8b-s1@http://gpu-host:8000 \
  --base-url http://litellm:4000 \
  --view my_app.views:stored_view \
  --stratify my_app.views:stratum \
  --self-agreement 0.95,0.90,0.98 \
  --out runs/swap-recorded.json
```

`my_app.views` stands for a module in an adapter package for your application; `--view`,
`--stratify` and `--self-agreement` are optional. The self-agreement figures above are
illustrative.

Calls made: `sample x number of candidates`. Records without an answer under the teacher key are
skipped and counted in `current.skipped`.

- **View** (`--view module:attr`): a batch function `(answers) -> answers or None`, applied to the
  recorded answers, the repeated answers and every candidate answer before scoring, so both sides
  are compared in the same form. `None` means unreadable. Use it when the application normalises
  the model's answer before storing it: the view runs the same normalisation, so a student is
  compared with what production actually keeps.
- **Strata** (`--stratify module:attr`): a function `(viewed recorded answer or None) -> group
  name`. Each candidate gets `strata[]`, agreement per group with an exact interval for 0/1 scores
  and a bootstrap interval otherwise. A typical split is empty against non-empty recorded answers.
- **Noise floor**, in this order:
  1. `--self-agreement VALUE` or `VALUE,LOW,HIGH`, a figure measured elsewhere, for example by
     asking the current model twice on a sample. `current.noise_source` is `provided`. The gap is
     unpaired: difference = candidate - floor, low = candidate low - floor high, high = candidate
     high - floor low, and `fixed`/`broken` are `null`.
  2. Records that also hold a repeated recorded answer under `--repeat-key` (default
     `<teacher>_repeat`). The repeat is scored against the first answer on those records
     (`noise_source: repeats`, `noise_cases`), and the gap is the usual paired bootstrap on the
     same records.
  3. Otherwise `noise_source: not_measured` and `noise_floor: null`; the summary prints
     `noise floor: not measured`. No floor is assumed. The only check is
     `agreement_lower_bound >= 1 - margin`: `switch` when it holds (the candidate is within the
     margin of any floor), else `inconclusive`. `do_not_switch` then only comes from a latency limit.
- `--max-cost-ratio` is refused: recorded answers carry no cost. `--max-p95-latency-ms` works.
- `report.repeats` is 0, `current` holds `teacher`, `cases`, `skipped`, `unreadable` (recorded
  answers the view or metric could not read; they score 0 for every candidate), and the noise
  fields. `candidates[].usage.answered_by` counts the model names the endpoint reported.
- History: one run per candidate with `agreement`, plus `self_agreement` and `agreement_gap` when a
  floor exists; with repeats, one more run for the recorded teacher.
- `--view`, `--stratify`, `--self-agreement` and `--repeat-key` are refused in live mode.

## Provider matrix

Name the same model several times with different URLs, for example a vLLM bf16 server and an fp8
server, plus the hosted provider through LiteLLM:

```bash
--candidate qwen/qwen3.7-flash \
--candidate qwen/qwen3.7-flash@http://gpu-a:8000 \
--candidate qwen/qwen3.7-flash-fp8@http://gpu-b:8000
```

Each one gets its own agreement, gap, cost, latency and verdict in the same run, against the same
noise floor.

## History and the dashboard

Every run appends to `--history` (default `history.jsonl`) under the benchmark `swap-<task>`:

- one run for the current model: per-record noise-floor scores, metric `self_agreement`;
- one run per candidate: per-record agreement and the candidate's answers, metrics `agreement`,
  `self_agreement` and `agreement_gap`.

Run ids are in the report (`current.run_id`, `candidates[].run_id`). Push one with:

```bash
modelstill push run runs/swap-history.jsonl <run-id> --task ticket-priority --primary-metric agreement
```

## Limits

- Agreement with today's model is not correctness. A candidate that fixes the current model's
  mistakes shows up as disagreement. When the gap is negative, read the `broken` records before
  deciding, or score both on the gold set with the gate.
- At temperature 0 the noise floor of a deterministic model is close to 1, so the margin carries the
  decision. Use the production temperature (`--temperature`) when callers sample.
- Requests are replayed with `--temperature` and `--max-tokens` only, not the production request's
  other parameters.
