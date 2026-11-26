# 0010. Train on your own GPU host over SSH by default; Modal is optional

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** maintainers

## Context

Modal bills every training hour, and repeated runs with several seeds add up. A workstation with
consumer GPUs, reached over SSH, trains the same models at no cloud cost. The reference host used
for this decision:

| | Value |
|---|---|
| GPUs | 3× RTX 5060 Ti, 16 GB each, Blackwell sm_120, driver 595.99 |
| Memory and disk | 30 GB RAM, 91 GB free disk |
| Tools | uv and Python 3.12 |
| Other workload | an inference server running as a systemd user service on two of the GPUs |

The pinned training stack runs on it as is: torch 2.15.0+cu132 (with sm_120), transformers 5.24.0,
TRL 1.18.2 and PEFT 0.22.0 (checked 24 Nov 2026). Docker there has no NVIDIA runtime.

## Decision

1. **The `remote` backend.** `modelstill.train.remote_backend` trains on an SSH host:
   - It copies `python/modelstill` and the plan's data files, named by content hash, to
     `~/modelstill/`, and runs `uv sync --frozen --extra train` there.
   - The job runs as a detached systemd user unit (`systemd-run --user --collect`; the user
     lingers), so a dropped SSH session does not stop it.
   - The operator's machine waits every `poll_seconds`, keeps waiting through dropped connections,
     and finally copies the artifact back. The copy on the host stays.
2. **GPUs.** They are chosen with `--gpus`. More than one GPU runs one process per GPU through
   `accelerate launch`. All processes share one checkpoint folder next to the final path, and only
   rank 0 publishes.
3. **Services holding the GPUs.** Services named with `--stop-service` are stopped for the run and
   restarted by a shell `trap` on exit, whether the run succeeded or failed. Stopping a service is
   always an explicit flag, never automatic.
4. **Memory.** `--gradient-checkpointing` turns on non-reentrant checkpointing for 16 GB cards.
5. **Modal stays.** It is the backend for runs that do not fit: full fine-tuning above about 4B,
   MoE models beyond about 8B active parameters, and teachers above about 8B. Those runs need an
   approved spend cap.

## Consequences

- Training costs no cloud money. It is slower per run than an L40S, and it takes down any service
  named with `--stop-service` while it runs.
- Serving for scoring also runs on the host, in a uv environment, because Docker has no GPU
  runtime there.
- No spend cap protects these runs. Instead, an artifact path can never be overwritten.

## Links

- Runbook: `../runbooks/train-and-serve-on-a-gpu-host.md`
- Code: `python/modelstill/src/modelstill/train/remote_backend.py`
