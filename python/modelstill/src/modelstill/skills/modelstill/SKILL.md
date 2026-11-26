---
name: modelstill
description: Use ModelStill to decide whether a cheaper or self-trained model can replace a cloud LLM call, measured on recorded production traffic. Covers ingesting Langfuse, OpenTelemetry, LiteLLM, Braintrust and JSONL traces, importing DeepEval, Inspect, Promptfoo and Braintrust results, pairwise judging of two runs, the pytest plugin, task specs, benchmarks and paired comparisons, the release gate, model and provider swaps without a gold set, training LoRA students (local GPU, an SSH GPU host, or Modal), the LiteLLM plugin for off/shadow/serve rollout, deferral thresholds, canaries and provider drift checks.
---

# ModelStill

ModelStill replaces or reduces a cloud LLM call for one narrow task. It works in this order:

1. Describe the task in a spec.
2. Score models on a benchmark.
3. Gate any change against the accepted baseline.
4. Optionally train a small student.
5. Roll it out through LiteLLM.
6. Keep watching it.

Every number it reports comes with an interval. Never present a single score as the result.

## Task spec

`tasks/<task>/spec.yaml` holds:
- the instruction and the output schema;
- prioritised requirements (`exact`, `set_f1`, `pass_fail`, `label`);
- the labelling teachers and the judge;
- the gate;
- the training base, the serving alias and the monitor.

Unknown keys are rejected.

```bash
modelstill spec validate tasks/<task>/spec.yaml
modelstill spec hash tasks/<task>/spec.yaml      # the snapshot every run is tied to
```

## Benchmarks and comparisons

Runs are appended to a history file (JSONL). Each run holds per-case scores, pooled F1 and
intervals.

```bash
modelstill eval runs history.jsonl                 # every run with score and interval
modelstill eval compare history.jsonl <before> <after>   # paired difference, fixed/broken
modelstill eval accept history.jsonl <run>         # make a run the baseline
modelstill eval pairwise history.jsonl <before> <after> --spec tasks/<task>/spec.yaml \
  --base-url http://localhost:4000            # a judge picks the better answer, both orders
```

Run ids may be given as a unique prefix. `eval pairwise` asks the spec's judge in both orders and
counts only a verdict that holds in both; a flip is a tie. It reports the win rate over decisive
cases with an exact interval, a sign test and the inconsistency rate. It refuses a judge from a
teacher's family.

## Reading what a team already has

Turn traces and logs into a dataset (inputs plus answers keyed by model, merged by input):

```bash
modelstill ingest langfuse --from 2026-11-01T00:00:00Z --to 2026-11-24T00:00:00Z \
  --name <observation-name> --out dataset.jsonl     # LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST
modelstill ingest otel traces.json --out dataset.jsonl       # OTLP JSON, GenAI semconv spans
modelstill ingest litellm spend_logs.csv --out dataset.jsonl # LiteLLM_SpendLogs export
modelstill ingest jsonl rows.jsonl --input request.messages --output answer \
  --model-field model --out dataset.jsonl
modelstill ingest braintrust logs.json --out dataset.jsonl   # Braintrust export (JSON, JSONL)
modelstill ingest braintrust --project-id <id> --out dataset.jsonl   # BRAINTRUST_API_KEY
modelstill ingest braintrust --dataset-id <id> --out dataset.jsonl --cases golden.jsonl
```

Record another tool's eval results as runs, then compare and gate them. Their metrics are kept
as they are, and ModelStill adds the intervals, the paired comparison and the gate:

```bash
modelstill import deepeval test_run.json --history runs.jsonl --task <slug> --accept
modelstill import inspect logs/run.eval --history runs.jsonl --task <slug> [--scorer name]
modelstill import promptfoo results.json --history runs.jsonl --task <slug> \
  --gate tasks/<task>/spec.yaml --flip-rate 0 --cost-ratio 1
modelstill import braintrust experiment.jsonl --history runs.jsonl --task <slug> --scorer <score>
modelstill import braintrust --experiment-id <id> --history runs.jsonl --task <slug> --scorer <score>
```

`--gate` needs `--flip-rate` and `--cost-ratio`, because eval files do not measure them. The p95
latency is taken from the file. A failed gate exits 1.

pytest (`pip install modelstill[pytest]`) records a session as a run:
- mark tests with `@pytest.mark.modelstill`, or use
  `@pytest.mark.modelstill_cases("golden.jsonl")` with a `case` argument;
- record graded scores with the `modelstill_score` fixture;
- run `pytest --modelstill-history runs.jsonl --modelstill-gate spec.yaml
  --modelstill-flip-rate 0 --modelstill-cost-ratio 1`.

See `docs/runbooks/ingest-and-import.md`.

## Release gate

The gate passes only if every check holds:
- the lower bound of the paired difference against the accepted baseline is at least
  `-max_regression`;
- the bf16/fp16 flip rate, the cost ratio and the p95 latency are within the spec.

A check that was not measured must be recorded at a failing worst-case value. Never record it as
passing. `push gate` reports checks at exactly those values to the dashboard as not measured; give
the reason with `--not-measured CHECK=REASON` (repeatable). It refuses a named check that passed.
`push gate` exits 0 on a pass, 2 on a fail (the decision is still recorded) and 1 on an error.

```bash
modelstill push gate history.jsonl <run> --task <slug> --spec tasks/<task>/spec.yaml \
  --previous <baseline-run> --flip-rate 1 --cost-ratio 9 --p95-latency-ms 99999
```

## CI gate

`modelstill report gate` decides the same gate without the API and prints it as a pull-request
comment (`--format markdown`) or as JSON (`--format json`). It lists every check with its
threshold, measured value, interval and result, then the paired comparison against the baseline:
the difference with its interval, fixed and broken counts, and the worst regressed cases. It exits
0 when the gate passes, 2 when it fails and 1 on an error.

```bash
modelstill report gate history.jsonl <run> --spec tasks/<task>/spec.yaml \
  --previous <baseline-run> --flip-rate 1 --cost-ratio 9 --p95-latency-ms 99999 --format markdown
```

In GitHub, the composite action `.github/actions/modelstill-gate` in the ModelStill repository
runs it, posts or updates one sticky comment on the pull request with `GITHUB_TOKEN`, and fails
the job when the gate fails. Pin it by commit. The job needs `pull-requests: write`:

```yaml
- uses: <modelstill-repo>/.github/actions/modelstill-gate@<commit-sha>
  with:
    spec: tasks/<task>/spec.yaml
    history: evals/history.jsonl
    run: ${{ steps.candidate.outputs.run }}
    baseline: ${{ vars.MODELSTILL_BASELINE_RUN }}
    flip-rate: ${{ steps.candidate.outputs.flip_rate }}
    cost-ratio: ${{ steps.candidate.outputs.cost_ratio }}
    p95-latency-ms: ${{ steps.candidate.outputs.p95_latency_ms }}
```

The step before it records the candidate run and prints `run=<id>` and the measured values to
`$GITHUB_OUTPUT`. Never add a provider key to the workflow for the gate: it reads only the history
file.

## Setup with a coding agent

`modelstill setup --agent print` (the default) prints a short fixed prompt for a coding agent.
`--agent claude` runs it with `claude -p` and `--agent codex` with `codex exec`, when that binary is
on the PATH. The command writes nothing itself.

`push task`, `push run` and `push review` send the spec, runs and review items to the dashboard
API. They need `MODELSTILL_API_URL` and `MODELSTILL_API_TOKEN`. By default `push run` sends each
case's input, expected answer, output and per-case metrics; `--no-content` sends only case hashes,
scores and per-case metrics, for sensitive data.

## Model or provider swap

`modelstill swap` decides whether to move a task to another model or provider, from recorded
production calls and without a gold set:

```bash
modelstill swap tasks/<task>/spec.yaml --records dataset.jsonl \
  --current deepseek/deepseek-v4-flash --candidate qwen/qwen3.7-flash \
  --candidate qwen/qwen3.7-flash@http://vllm-host:8000 \
  --base-url http://litellm:4000 --sample 300 --repeats 2 \
  --litellm-config litellm-config.yaml --out swap.json
```

- The current model answers every record twice. Its agreement with itself is the noise floor.
- Each candidate answers once and is scored against the current model's first answers with the
  spec's metric (`set_f1` for set requirements, JSON equality otherwise). Override it with
  `--metric`: `exact`, `json`, `set_f1` or `module:attr`.
- `model@base-url` sends a model to another endpoint. Several give a provider and precision matrix.
- The report holds both agreements with intervals (exact for 0/1 scores), the paired gap, the
  unreadable-answer rate, cost per 1,000 calls, p50/p95 latency and agreement with the recorded
  production answer.
- The decision is `switch` when the gap's lower bound is at least `-margin` (the gate's
  `max_regression` unless `--margin` is given), `do_not_switch` when its upper bound is below it or a
  `--max-cost-ratio`/`--max-p95-latency-ms` limit fails, else `inconclusive`. Every check keeps its
  threshold and measured value. The report ends with the LiteLLM `model_list` change for the
  cheapest switch.
- `--current recorded[:<teacher-key>]` compares candidates with the stored answers (default key
  `production`) and never calls the current model. The noise floor is `--self-agreement VALUE` or
  `VALUE,LOW,HIGH` (unpaired gap), else records with a `<teacher>_repeat` answer (paired gap), else
  it is reported as `not measured` and only `agreement_lower_bound >= 1 - margin` can switch.
  `--view module:attr` maps recorded and candidate answers in batches before scoring (for example a
  function in your own adapter package that reduces an answer to what your application stores); `--stratify module:attr` names a group per
  recorded answer and each candidate gets per-group agreement with intervals. `--max-cost-ratio` is
  refused there.
- Runs go to `--history` (default `history.jsonl`). Send one to the dashboard with
  `modelstill push run history.jsonl <run> --task <slug> --primary-metric agreement`.

## Training a student

Training data is chat JSONL: `{"messages": [system, user, assistant]}`. The loss covers only the
assistant turn. Build it from recorded production answers, filtered against the output schema
and split by group (for example by employer), with the gold set excluded.

```bash
modelstill train run tasks/<task>/spec.yaml --train train.jsonl --val val.jsonl --seed 1 \
  --backend remote --host <ssh-host> --gpus 0,1,2 --stop-service <service-holding-gpus> \
  --batch-size 1 --gradient-accumulation 2 --gradient-checkpointing --max-seq-length 4096
```

- **Methods:**
  - `--method lora` (default) trains an adapter;
  - `--method full` trains every weight (default learning rate 1e-5) and publishes a merged
    artifact;
  - `--method distill --teacher <model> [--beta 1.0]` is on-policy distillation. The student
    samples, the teacher scores every token, and the student is trained on the reverse KL
    (`--beta 0` for forward KL). Teacher and student must share a tokenizer.
  - `--method grpo --reward json_equal [--loss dapo|grpo|dr_grpo|bnpo|cispo]
    [--importance-level token|sequence] [--num-generations 4]` is reinforcement learning. Each
    prompt gets several samples, scored by the reward against the recorded answer, using the
    built-ins `exact_match` and `json_equal` or a task metric given as `module:attr`. The best
    checkpoint is the one with the highest validation reward. Clipped importance sampling
    (`cispo`), sequence-level ratios (`--importance-level sequence`) and a KL penalty are
    supported. Multi-turn and tool-use episodes use `rl.environment: module:attr` (TRL
    `environment_factory`).
- **Images:** a message's content may be a list of parts, `{"type": "text", "text": ...}` and
  `{"type": "image", "image": "data:image/png;base64,..."}`. Embed images as data URLs so the
  file stays self-contained. Train with `--modality vision` and a vision-language base (for
  example `Qwen/Qwen3-VL-2B-Instruct`), using lora or full SFT.
- **Backends:**
  - `trl`: this machine's GPU;
  - `remote`: an SSH GPU host, running as a detached systemd unit with one process per GPU;
  - `modal`: Modal. Use `--dry-run` first to see the cost.
- **Artifacts:** they are written to `<output-root>/<task>/<snap8>-<manifest8>-s<seed>` and never
  overwritten. The run with the lowest validation loss is the one published.
- **Resuming:** a run that stopped part-way resumes from its latest checkpoint when the same
  command is run again.
- **Do not train on a laptop.** Use `remote` or `modal`.

Each artifact carries `attestation.json`: the sha256, row count and row-hash root of its training
and validation files, the manifest digest and the git commit. Check data against it with
`modelstill attest verify <artifact> --train train.jsonl --val val.jsonl` (exit 1 on a mismatch).

Export with `modelstill export <artifact> --to peft --out DIR` (a copy of the adapter). Use
`--to merged` (bf16 weights) or `--to gguf --outtype q8_0` (llama.cpp) with `--host <ssh-host>`:
those load the model, so they run on the GPU host.

`modelstill train infer <artifact> <prompt-json>` generates with one artifact on a machine with
a GPU.

## Serving on a GPU host

```bash
modelstill serve up <artifact> [<artifact>...] --host <ssh-host> --gpu 1 --port 8100
modelstill serve down --host <ssh-host> --port 8100
```

`serve up` starts vLLM with the same settings as the Modal deployment (bf16, 8,192 context,
LoRA modules, logprobs, thinking off), bound to 127.0.0.1 on the host and protected by the key in
`~/.config/modelstill/student.key`. It prints the `ssh -L` tunnel to reach it. A merged
(full-weight) artifact is served alone under its own name.

`modelstill sample <served-name> --prompts prompts.jsonl --out out.jsonl --top-logprobs 5` writes
one row per prompt: the answer, the model that answered, token counts, the mean logprob and, with
`--top-logprobs`, the per-token alternatives.

## Rollout through LiteLLM

The task keeps its LiteLLM name. That name points at the `modelstill/<task>` custom provider, and
the old cloud deployment moves to `<task>-cloud`. A deployment file sets the mode; when the plugin
config has an `api` block, the task's API deployment record (`set_deployment_mode`,
`PUT /v1/tasks/{slug}/deployment`) wins over the file while the API answers. Modes:
- `off`: log only;
- `shadow`: the cloud answers, and a sample is also sent to the student;
- `serve`: the student answers unless it is unsure or the wrong model.

Rollback is `mode: off` (in the API record when the plugin follows it, else in the file), which
takes effect within 30 s. Calibrate the deferral threshold on the
calibration split, never on the gold set:

```bash
modelstill serve calibrate calib_pairs.jsonl --target-error 0.05 --deployment deployment.yaml
```

## Monitoring

```bash
modelstill monitor canary monitor.yaml --fail-on-alert   # known-answer checks, exact interval
modelstill monitor drift monitor.yaml --fail-on-alert    # temperature-0 answer hashes
modelstill watch baseline watch.yaml                      # approval day: canary + logprob baseline
modelstill watch check watch.yaml --fail-on-alert --fallback-deployment deployment.yaml
```

`watch check` compares against the approval-day baseline, not the last run: canary with an exact
McNemar test, answer hashes, and a sign-flip test of token log-prob shift beyond the baseline's
own noise. Levels are info, warn and critical; on critical, `--fallback-deployment` sets the
deployment to `mode: off`. With `MODELSTILL_API_URL` and `MODELSTILL_API_TOKEN` set (or `--api URL`),
canary runs and alerts are also pushed to the API for the dashboard's Monitoring page; the push
never fails the run, and `--no-api` turns it off.

A changed drift hash behind an unchanged alias means the provider changed the model.
