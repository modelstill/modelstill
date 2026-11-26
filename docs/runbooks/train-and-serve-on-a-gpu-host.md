# Train, export and serve on a GPU host over SSH

The default since [ADR 0010](../decisions/0010-train-on-the-owners-gpu-host.md). The host is any
Linux machine with NVIDIA GPUs, uv and systemd user services, reached over SSH. The commands below
call it `gpu-host`; use the name from your SSH config. Nothing trains or loads a model on the
operator's machine. Methods and their limits are in
[ADR 0008](../decisions/0008-training-methods.md).

## Rules

- Only one remote job at a time. Every job first syncs `python/modelstill` to
  `~/modelstill/python/modelstill` with `--delete`, which would change the code under a job
  that is already running.
- A job that needs GPUs another service holds must pass `--stop-service <unit>` (repeatable). The
  service is restarted when the job ends, whether it succeeded or failed. Check it afterwards
  with `ssh gpu-host 'systemctl --user is-active <unit>'`.
- Jobs are systemd user units (`modelstill-train-*`, `modelstill-export-*`, `modelstill-serve-*`).
  The user must linger (`loginctl enable-linger`), so units outlive SSH sessions. List them with
  `systemctl --user list-units 'modelstill-*'`. Logs are in `~/modelstill/runs/<id>.log` and
  `~/modelstill/serve/<port>.log`.
- `systemctl --user is-active` takes exact unit names, not wildcards.

## Train

```bash
cd python/modelstill
uv run modelstill train run ../../tasks/<task>/spec.yaml \
  --train $DATA/sft_train.jsonl --val $DATA/sft_val.jsonl --seed 1 \
  --base Qwen/Qwen3-4B --epochs 2 --eval-steps 400 --max-seq-length 4096 \
  --batch-size 1 --gradient-accumulation 2 --gradient-checkpointing \
  --backend remote --host gpu-host --gpus 0,1,2
```

- **Measured** on 3× RTX 5060 Ti (16 GB each): Qwen3-4B LoRA, DDP on 3 GPUs, per-device batch 1,
  accumulation 2 and gradient checkpointing use about 11 GB per GPU and run at about 0.75–0.85
  epochs an hour on several thousand rows of up to 4k tokens (24 Nov 2026).
- **The first run of a base model** downloads it into `~/.cache/huggingface` on the host. That
  took about 7 minutes for Qwen3-4B.
- **Methods:** add `--method full`, `--method distill --teacher <model>`,
  `--method grpo --reward json_equal [--loss cispo]`, `--modality vision` or
  `--quantization 4bit`.
- **A stopped run resumes** from its latest checkpoint when the same command is run again, because
  the same plan gives the same artifact path.
- **The artifact comes back** to `--output-root` (default `artifacts/`). It holds
  `artifact.json`, `attestation.json` and `log_history.json`, and a copy stays on the host under
  `~/modelstill/adapters/`.

## Export

```bash
uv run modelstill export $ART --to peft --out out/peft
uv run modelstill export $ART --to gguf --outtype q8_0 --out out/gguf --host gpu-host --gpu 1
```

`merged` and `gguf` load the model, so they run on the host. GGUF uses a llama.cpp checkout on
the host (`--llama-cpp`, default `~/Projects/llama.cpp`).

## Serve and score

vLLM 0.34.0 lives in its own environment on the host, `~/modelstill/serve/.venv`. Its torch is
2.14, while the training stack uses 2.15.

```bash
uv run modelstill serve up $ART --host gpu-host --gpu 1 --port 8100
ssh -N -L 8100:127.0.0.1:8100 gpu-host &      # the tunnel serve up prints
uv run modelstill sample <served-name> --prompts prompts.jsonl --out out.jsonl --top-logprobs 5
uv run modelstill serve down --host gpu-host --port 8100
```

The server listens on 127.0.0.1 only and needs the key from `~/.config/modelstill/student.key`.

To score the served model, point your task's scorer at `http://127.0.0.1:8100` and record the run
in the history file that holds the accepted baseline (`modelstill.evals.run`, see
[scorers.md](scorers.md)). To measure how closely it copies recorded answers, use
`modelstill swap --current recorded` ([model-swap.md](model-swap.md)). Then
`modelstill eval compare` and `modelstill push run` / `push gate` work on the run as for any other.
