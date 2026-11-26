# 0008. Training methods: LoRA, full fine-tuning, distillation and GRPO

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** maintainers

## Context

Before this ADR, ModelStill trained LoRA SFT only. Teams also need full-weight fine-tuning,
on-policy distillation from a larger teacher, reinforcement learning against a task reward,
sampling with log-probabilities, export formats and a record of what data trained an artifact.
All of it should run on open tools with pinned versions.

## Decision

1. **Methods.** `TrainingPlan.method` is one of `lora`, `full`, `distill` or `grpo`. Each
   method's settings live in a sub-model, `DistillSettings` or `RlSettings`. A validator rejects
   settings that don't match the method. They enter the manifest, so they change the artifact
   path.
2. **Trainers.** Each method runs on a TRL 1.18.2 trainer, pinned:
   - `lora` and `full`: `SFTTrainer`. Full fine-tuning has no PEFT, defaults to learning rate
     1e-5, and publishes a `merged` artifact.
   - `distill`: `DistillationTrainer`, which is on-policy. The student samples and the teacher
     scores each token. The divergence is generalised JSD by `beta`: 1 is reverse KL, the
     default; 0 is forward KL. Student and teacher must share a vocabulary.
   - `grpo`: `GRPOTrainer`, with the losses `grpo`, `dr_grpo`, `dapo` (default), `bnpo` and
     `cispo`; token- or sequence-level importance ratios; `epsilon` and `epsilon_high`; a KL
     penalty `kl_beta`; and several generations per prompt.
     - **Rewards** compare each completion with the recorded production answer: `exact_match`,
       `json_equal`, or a task metric as `module:attr`.
     - **The published checkpoint** is the one with the highest validation reward.
     - **Multi-turn and tool-use episodes** use `rl.environment: module:attr`, passed to TRL's
       `environment_factory`.
3. **What is covered, and how:**

   | Capability | ModelStill |
   |---|---|
   | LoRA and full-weight SFT | `--method lora`, `--method full` |
   | RL with CISPO | `--loss cispo` |
   | RL with clipped objectives | `dapo`/`grpo` with `epsilon`, `epsilon_high` (no value model) |
   | Importance sampling | `--importance-level token|sequence` |
   | Multi-turn and tool-use RL | `rl.environment` (TRL environment factory) |
   | On-policy distillation | `--method distill --teacher` |
   | Sampling with logprobs | `modelstill sample --top-logprobs` |
   | Checkpoint recovery | rerunning the same command resumes from the latest checkpoint |
   | OpenAI-compatible serving | `modelstill serve up/down` on a GPU host; the Modal app scales to zero |
   | Export | `modelstill export --to peft` (and `merged`, `gguf`) |
   | Training-data attestation | `attestation.json` per artifact; `modelstill attest verify` |
   | Coding-agent skill in the package | `python -m modelstill.skill --install` |
   | Image inputs | not yet |
   | Async RL with stale policies | not yet: TRL's `AsyncGRPOTrainer` needs a vLLM server in the training environment |
   | Large MoE models | only those that fit the GPUs at hand: LoRA on 16 GB cards; bigger runs go to Modal with an approved spend cap |

4. **Generation during GRPO.** It uses Hugging Face `generate`, not vLLM. vLLM 0.34.0 pins a
   different torch (2.14) from the training stack (2.15), so it lives in its own environment on
   the host (`~/modelstill/serve/.venv`).

5. **4-bit QLoRA.** `quantization: 4bit` loads the base through bitsandbytes: NF4, double
   quantisation, and compute in the training dtype. Each process loads onto its own GPU
   (`device_map` from `LOCAL_RANK`). It is for LoRA only, and it lets 8B models and about
   30B-A3B MoE models fit on 16 GB cards. `bitsandbytes==0.50.2` (27 Aug 2026, torch >= 2.4, < 3)
   joins the `train` extra.

6. **GGUF export.** It runs llama.cpp's `convert_hf_to_gguf.py` from the host's checkout, using the
   training environment, which needs `sentencepiece` for Qwen-family vocabularies.
   `sentencepiece==0.2.3` (5 Nov 2026) joins the `train` extra. llama.cpp requires
   `>=0.1.98,<0.3.0`.
7. **Smoke runs on a GPU host** (Qwen3-0.6B, one 16 GB GPU, 24 Nov 2026):

   | Method | Result |
   |---|---|
   | `lora` | passed |
   | `full` | passed: merged artifact, attestation verified |
   | `distill` (Qwen3-1.7B teacher, 20 steps, 19 min) | passed |
   | `4bit` QLoRA | passed |
   | `grpo` with `json_equal` | ran end to end, but reward stayed 0 |

   The untrained base never matched the recorded answer exactly within 256 tokens, so GRPO had no
   reward differences to learn from. Real GRPO runs start from a model already trained on the task,
   with a graded reward such as set F1, not `json_equal`.

## Consequences

- GRPO on 16 GB GPUs is slow for models above about 1.7B, because generation runs inside the
  training process.
- Each method is unit-tested through its settings and plan validation. The trainers themselves
  run only in smoke runs on a GPU host (Qwen3-0.6B, 50 steps or fewer), never on a laptop.
- Training metrics reach the dashboard through the training console
  (`../runbooks/training-console.md`).
