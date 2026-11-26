# 0005. Train on Modal L40S and serve students with vLLM 0.34.0 on Modal A10G

- **Status:** proposed; since [ADR 0010](0010-train-on-the-owners-gpu-host.md) Modal is the
  optional backend, not the default
- **Date:** 2026-11-23
- **Deciders:** maintainers

## Context

Training must not run on a developer laptop, and when this was written no CUDA machine was
available (ADR 0002). Modal bills GPUs per second, has workspace spend limits and needs no
standing infrastructure. The first runs are Qwen3-1.7B and Qwen3-4B LoRA on a few thousand rows of
up to 4k tokens, 3 epochs, 3 seeds. The gateway (ADR 0004) needs an OpenAI-compatible student
endpoint that returns token log-probabilities and reports which model answered.

Read on 2026-11-23:

- Modal prices (modal.com/pricing, per second x 3,600): A10G $1.102/h, L40S $1.951/h, H100
  $3.949/h, A100 80 GB $2.498/h, L4 $0.799/h; CPU $0.0472 per core-hour, memory $0.0080 per
  GiB-hour. Spend limits are set per workspace under Settings > Usage & Billing (owners and
  managers only); at the limit Modal stops workloads that would add charges.
- PyPI: `modal` 1.6.4 (2026-11-12) is the newest release. `vllm` 0.34.0 (2026-11-16) is the newest
  release and requires `transformers>=5.16.1,<5.23.0`, `torch==2.14.0` and `pydantic>=2.12.0`.
  The newest transformers it allows is 5.22.2 (2026-11-06). No vLLM release accepts the training
  pin `transformers==5.24.0`, and vLLM's pydantic floor conflicts with the core's
  `pydantic==2.11.7`.

## Decision

1. **Training** runs the unchanged TRL backend inside a Modal function
   (`modelstill.train.modal_backend`, extra `modal = ["modal==1.6.4"]`). Its image is Debian slim,
   Python 3.12, with exactly the core dependencies and the `train` extra, read from the installed
   package metadata, so it cannot drift from `pyproject.toml` and the manifest records the ADR
   0002 versions. Inputs, plans and artifacts live in the volume `modelstill-artifacts` (inputs
   and plans named by content hash, artifacts at the ADR 0002 immutable path under
   `adapters/`); the Hugging Face cache lives in `modelstill-hf-cache`.
2. **Default training GPU: L40S** (48 GB), 2 CPU cores, 16 GiB memory, $2.17/h in all. Per run
   it is cheaper than A10G: 362 vs 125 dense BF16 TFLOPS for 1.8x the price, and a 24 GB A10G
   cannot hold batch-4, 4k-token logits over Qwen3's 151,936-token vocabulary next to the model.
   H100 is 14-22% cheaper per run on paper (989 TFLOPS for 2x the L40S price) if it reaches
   the same utilisation, which small models often do not; it is a `--gpu H100` away, to try
   once a measured L40S run exists.
3. **Every run has a hard timeout**, by default twice the estimate (at most 24 h). The timeout is
   the spend cap: `--dry-run` prints it and its dollar value before anything runs.
4. **Serving** uses `deploy/modal/modelstill_student.py`: vLLM `0.34.0` with `transformers==5.22.2`
   (and vLLM's own `torch==2.14.0`) on an A10G, LoRA adapters served under their versioned names
   (`<task>-<snapshot8>-<manifest8>-s<seed>`), `--max-logprobs 5`, Qwen3 thinking off by
   default, at most one container with 32 concurrent requests, scale to zero after 5 idle
   minutes, and the key from the Modal secret `modelstill-student-auth` (`VLLM_API_KEY`).
   The serving image does not install `modelstill`.
5. **Scoring** stays on the operator's machine: the task's scorer calls the served model over
   HTTP, so student and cloud baseline are scored by the same code and compared case by case.

## Consequences

- Training (transformers 5.24.0, torch 2.15.0) and serving (5.22.2, torch 2.14.0) use different
  library versions. A LoRA adapter is PEFT safetensors plus the base's tokenizer and chat
  template, so it loads across these versions, but greedy answers may differ slightly: the gate's
  flip rate must be measured on the vLLM-served model, not on local transformers output. When a
  vLLM release accepts transformers 5.24, move serving to it through a new ADR.
- Cost estimates are arithmetic on an assumed 25% utilisation (`modal_plan.UTILIZATION`). After
  a first run, replace it with the measured rate from `train_runtime_s` in `artifact.json`.
- The run is an ephemeral Modal app tied to the operator's terminal: closing the laptop stops it
  (and its spend). Keep the machine awake for the run (`caffeinate -i` on macOS).
- To verify on a first run: that `staged_output`'s directory rename works on a Modal volume, and
  that TRL 1.18.2 fits Qwen3-4B at batch 4 and 4k tokens in 48 GB (fall back to
  `--batch-size 2 --gradient-accumulation 2`).
- How to tell the decision stopped holding: a measured L40S run costs more than the H100
  estimate, or Modal prices change (re-read the pricing page and update `GPU_PRICES_PER_HOUR`).

## Alternatives considered

- A10G for training: about twice the cost per run by the estimate, and not enough memory for
  4k-token rows at batch 4.
- Serving with the training stack (transformers `generate` in a Modal class): no continuous
  batching, so slower and dearer per request, and it would reimplement the OpenAI API.
- Loosening the training pin to transformers 5.22.2 so both stacks match: downgrades a pinned
  training stack (ADR 0002) to suit a server that only needs to load adapters.
- Running the benchmark inside Modal: puts the application's scorer and gold set in Modal and
  bills CPU time for an HTTP loop.

## Links

- Runbook: `../runbooks/train-and-serve-on-modal.md`
- Code: `python/modelstill/src/modelstill/train/modal_plan.py`,
  `python/modelstill/src/modelstill/train/modal_backend.py`, `deploy/modal/modelstill_student.py`

## Notes moved from code

- `train/modal_backend.py`: Modal imports the module again inside the container, where the package
  is plain source with no metadata, so the image pins are read only on the operator's machine, where
  the image is built. `trl_backend` is imported inside `train_remote` (the `PLC0415` suppression)
  because the operator's machine loads the module without torch or TRL.
- `train/modal_plan.py`: the cost estimate is arithmetic on stated assumptions (`ASSUMPTIONS`), not
  a measurement; the spend cap is the timeout, where Modal stops the function, so `max_cost_usd`
  bounds one run. Without packing every row in a batch is padded to the longest one, so the
  estimate uses the mean longest row of a random batch, not the mean length. Inputs and plans are
  named by content so a re-run uploads nothing new.
- `deploy/modal/modelstill_student.py`: it does not import `modelstill`, whose pydantic pin
  conflicts with vLLM's. One vLLM server holds one base model, so every adapter served together must
  share one base. The API key comes from the Modal secret `modelstill-student-auth` (key
  `VLLM_API_KEY`), which the file never creates. Adapters are served under their versioned names,
  which vLLM returns in `model`, so the gateway's model check sees exactly which artifact answered.
