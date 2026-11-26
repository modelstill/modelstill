# 0002. Train with TRL SFTTrainer and PEFT LoRA, pinned in the `train` extra

- **Status:** accepted
- **Date:** 2026-11-23
- **Deciders:** maintainers

## Context

`modelstill.train` needs a first backend that trains LoRA adapters on chat-format SFT rows, runs
on a developer Mac (Apple Silicon, MPS) and on CUDA, and records enough to reproduce a run.
AGENTS.md requires TRL and transformers pinned to exact versions, and the core library must not
depend on any of it (ADR 0001).

Versions were read from PyPI on 2026-11-23, taking the newest release of each and checking the
declared requirements against each other: TRL 1.18.2 needs `transformers>=4.56.2`,
`accelerate>=1.11.0`, `datasets>=4.7.0`, `torch>=2.6.0`; transformers 5.24.0 needs
`tokenizers>=0.23.1,<0.24` and `huggingface-hub>=1.31,<3`; torch 2.15.0 ships macOS arm64 wheels
for CPython 3.11-3.15. The set installs together under uv and passes the slow test suite and a
Qwen3-0.6B LoRA run on an Apple Silicon laptop with MPS.

## Decision

The optional extra `train` (`pip install 'modelstill[train]'`) pins:

| Package | Version |
|---|---|
| torch | 2.15.0 |
| transformers | 5.24.0 |
| trl | 1.18.2 |
| peft | 0.22.0 |
| accelerate | 1.16.0 |
| datasets | 5.2.0 |

Only `modelstill.train.trl_backend` and `modelstill.train.local_infer` import them; the core loads
the backend by name through `importlib`, and a test proves `import modelstill.cli` pulls in none of
them. Training uses TRL's conversational prompt-completion format with `completion_only_loss`, so
loss covers only the final assistant turn even for chat templates without `{% generation %}`
markers (Qwen3). Every run's manifest records the installed versions of these six packages, so an
artifact names the stack that made it.

Train dtype `auto` is bf16 on CUDA with bf16 support and fp32 elsewhere (MPS, CPU).

## Consequences

- Upgrading any of the six is a new ADR plus a full gate re-run: the manifest digest, and so every
  artifact path, changes with library versions.
- transformers 5.24.0 was two days old when pinned. If a regression appears, step back to the
  previous 5.x patch through a superseding ADR rather than loosening the pin.
- The core type check runs without the extra, so the two backend modules disable
  `reportMissingImports` at file level; with the extra installed they are fully checked.
- MPS training is fp32: slower and heavier than bf16 on CUDA. Fine for smoke runs and small
  bases; full Qwen3-1.7B runs with three seeds are expected on a CUDA box.

## Alternatives considered

- Unsloth: faster on CUDA, but no Apple Silicon support and it patches transformers internals.
- MLX-LM: fast on Apple Silicon, but Mac-only; adapters would need conversion for vLLM serving.
- Hand-written training loop on transformers: reimplements what TRL already gets right (masking,
  packing, chat templates), against ADR 0001's "ModelStill does not reimplement training".
- `assistant_only_loss` on `messages` rows: needs generation markers that Qwen3's template lacks.

## Links

- Code: `python/modelstill/src/modelstill/train/`, `python/modelstill/pyproject.toml`

## Notes moved from code

- `train/config.py`: the published adapter is the checkpoint with the lowest validation loss, not
  the last one. On an early three-epoch Qwen3-4B run, validation loss reached its minimum at
  epoch 2 and rose during the third. Two checkpoints (best and latest) are kept while
  training, inside the staging folder that is removed before publishing; checkpoints are never
  published.
- `train/trl_backend.py`: precision `auto` is bf16 on CUDA that supports it, else fp32, because
  fp16/bf16 LoRA training on MPS and CPU is slower or unstable at these model sizes.
- `train/local_infer.py`: chat templates are rendered with thinking off (Qwen3), as in training;
  templates without that switch ignore it. The confidence signal is the mean log-probability of the
  generated tokens, end-of-turn token included.
- `train/local_infer.py`, `train/trl_backend.py`, `train/modal_backend.py` and
  `deploy/modal/modelstill_student.py` carry `# pyright: reportMissingImports=false` because the
  core's type check runs without the `train` and `modal` extras; with them installed the imports
  resolve.
- Published artifact paths are immutable (`staged_output` raises `FileExistsError`) because serving
  caches key on them.
