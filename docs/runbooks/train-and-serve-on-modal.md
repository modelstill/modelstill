# Train and serve a student on Modal

Trains LoRA adapters on a Modal GPU, serves them with vLLM on Modal, and scores the served model
on the gold set from your own machine. Nothing here trains or loads a model on your laptop.
Decision and versions: [ADR 0005](../decisions/0005-modal-training-and-serving.md). Code:
`python/modelstill/src/modelstill/train/modal_backend.py`, `deploy/modal/modelstill_student.py`.

Prices below are Modal's list prices on 2026-11-23 (L40S $1.951/h, A10G $1.102/h, plus CPU and
memory). Training estimates assume a few thousand rows of 4k tokens each, so runs on shorter rows
cost less. They are estimates from the dry run's arithmetic, not measurements.

| Step | What runs on Modal | Expected cost |
|---|---|---|
| (a) dry run | nothing | $0 |
| (b) one training run, Qwen3-1.7B, 1 seed | L40S, about 1.5 h | about $3.30, capped at $6.70 |
| (b) one training run, Qwen3-4B, 1 seed | L40S, about 3.3 h | about $7.25, capped at $14.50 |
| (c) serving | A10G while requests arrive, nothing when idle | $1.32/h warm; $0 idle |
| (d) scoring a gold set of a few hundred items | the serving container | well under $1 |
| (e) stopping | nothing | $0 |

Three seeds are three runs: multiply the training row by 3.

## 0. Before the first run

1. Set a spend limit. In the Modal dashboard, **Settings > Usage & Billing**, set the workspace
   spend limit (owners and managers only). When it is reached Modal stops workloads that would add
   charges. On Team plans, an environment budget can be set under
   **Settings > Workspace Management > Environments**.
2. Install the CLI into the library's environment and check which workspace it uses:

   ```bash
   cd python/modelstill
   uv sync --extra dev --extra modal
   uv run modal profile current          # the workspace that will be billed
   ```

   If it is not the intended workspace: `uv run modal profile activate <name>`.
3. Have the SFT files (chat-format JSONL, the last turn being the answer to learn) and the spec:

   ```bash
   export DATA=/path/outside/the/repo/data
   export SPEC=../../tasks/<task>/spec.yaml
   ```

## (a) Dry run

Prints, per seed, the exact plan (with its volume paths), the files it would upload, the image
pins, GPU, timeout, an estimate and the cost at the timeout. It imports no Modal code and
contacts nothing.

```bash
uv run modelstill train run $SPEC --train $DATA/sft_train.jsonl --val $DATA/sft_val.jsonl \
  --max-seq-length 4096 --eval-steps 200 --seed 1 \
  --backend modal --dry-run
```

Read `estimated_cost_usd`, `timeout_minutes` and `max_cost_usd`. `max_cost_usd` is the most one
run can cost: Modal kills the function at the timeout. `--eval-steps 200` keeps validation to
about 10 passes; the default 50 adds about a quarter to the cost. Add `--base Qwen/Qwen3-4B` for
the 4B base and `--gpu H100` to compare GPUs. For Qwen3-4B, if a run fails with CUDA out of
memory, use `--batch-size 2 --gradient-accumulation 2` (same effective batch).

## (b) One capped training run

Same command without `--dry-run`, with the timeout you approved. Keep the machine awake: the run
is an ephemeral Modal app that stops when this terminal disconnects.

```bash
caffeinate -i uv run modelstill train run $SPEC \
  --train $DATA/sft_train.jsonl --val $DATA/sft_val.jsonl \
  --max-seq-length 4096 --eval-steps 200 --seed 1 \
  --backend modal --gpu L40S --timeout-minutes 185
```

- The first run builds the image (a few CPU minutes, cents) and downloads the base model into the
  `modelstill-hf-cache` volume. Both volumes are created on first use.
- It prints one JSON line: `path` (inside the container, `/artifacts/adapters/<task>/<version>`),
  `served_name` and the metrics. The volume path is `adapters/<task>/<version>`.
- An existing path is never overwritten: the same data, plan and library versions give the same
  path, and the run fails with "already exists" rather than replacing it.
- Watch it live at the URL Modal prints, or under **Apps > modelstill-train**.

List and download artifacts:

```bash
uv run modal volume ls modelstill-artifacts adapters/<task>
uv run modal volume get modelstill-artifacts adapters/<task>/<version> ./artifacts/<task>/
```

## (c) Serving

Create the auth secret once (the key never goes into the repo; keep a copy for clients):

```bash
umask 077; openssl rand -hex 32 > ~/.config/modelstill/student.key
uv run modal secret create modelstill-student-auth VLLM_API_KEY="$(cat ~/.config/modelstill/student.key)"
```

Deploy with the adapters to serve (comma-separated `<task>/<version>`, one base model):

```bash
MODELSTILL_ADAPTERS=<task>/<version> \
  uv run modal deploy ../../deploy/modal/modelstill_student.py
```

`MODELSTILL_SERVE_GPU=L4` deploys on an L4 ($0.80/h, slower decoding) instead of an A10G.
Deploying costs nothing until a request arrives. `modal deploy` prints the endpoint URL, which
carries your workspace name. The first request starts a container (two to four minutes, longer on
the very first start while weights download); it stops after 5 idle minutes. Check it:

```bash
export STUDENT_URL=<the URL modal deploy printed>
curl -s $STUDENT_URL/v1/models -H "Authorization: Bearer $(cat ~/.config/modelstill/student.key)"
```

`data[].id` lists each adapter under its served name, e.g. `ticket-priority-1a2b3c4d-5e6f7a8b-s1`.
That name is the `student_model` in the deployment file, and the plugin's student endpoint is
`base_url: $STUDENT_URL` with `api_key_env: MODELSTILL_STUDENT_KEY`
([serving-and-monitoring.md](serving-and-monitoring.md)).

## (d) Scoring and comparing with the accepted cloud baseline

The client runs on your machine; only inference runs on Modal. Use the history file that holds the
accepted cloud baseline (`uv run modelstill eval runs $DATA/history.jsonl`; accept one with
`modelstill eval accept` if none is).

The core has no single command for this step, because the scorer belongs to the task. Point your
task's scorer at `$STUDENT_URL` with the served name as the model, and record the run in the same
history file (`modelstill.evals.run`, see [scorers.md](scorers.md)). Two rules for that script:

- Score the student with the same code that scored the cloud baseline, so the two runs pair case
  by case.
- Fail the run if any answer came from a model other than the served name, or any request failed.

Then compare and gate as for any run:

```bash
uv run modelstill eval compare $DATA/history.jsonl <baseline-run> <student-run>
```

`modelstill push run` and `push gate` work on it too. To measure how closely the student copies
recorded production answers without a gold set, use `modelstill swap --current recorded`
([model-swap.md](model-swap.md)).

## (e) Stopping everything

```bash
uv run modal app list                       # anything still deployed or running
uv run modal app stop modelstill-student    # serving: no container can start again
uv run modal app stop modelstill-train      # only if a training run is still listed
```

A training run also stops when its terminal is interrupted (Ctrl-C) or at its timeout. A stopped
serving app costs nothing; redeploy with (c). Volumes keep the artifacts; do not delete
`modelstill-artifacts`, because artifact paths are meant to be permanent.
