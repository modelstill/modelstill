# 0001: ModelStill is a framework first, a platform second

- Status: accepted (parts changed by [ADR 0016](0016-ai-quality-platform.md))
- Date: 2026-11-23
- Deciders: maintainers

## Context

ModelStill started as an internal platform to move one application's narrow LLM tasks onto small
owned models. The goal is now wider: a framework that any team can use to build, train, evaluate and
monitor its own small models, and in particular a library for writing evaluations and benchmarks
that make a trained model trustworthy.

Research done before this decision (job postings, issue trackers, code of comparable projects,
papers, search data):

- Companies do this work in-house. Teams that hire for the whole loop build on open-source parts
  (Hugging Face, TRL, MLflow, vLLM) and rarely name a fine-tuning vendor. Searches for buying a
  "fine-tuning platform" are near zero, while do-it-yourself training libraries are searched for
  far more often.
- Several hosted fine-tuning platforms of the first wave were acquired, archived or shut down. The
  clouds now offer distillation themselves.
- The missing layer is trust. Across trackers for training, evaluation, benchmarks, security tests
  and serving, the recurring unmet need is checking that something is right: judges never checked
  against people, graders that agents can cheat, served models that differ from trained ones,
  scores without intervals, no history across runs. Evaluation libraries are installed far more
  often than end-to-end fine-tuning frameworks.
- Research supports specific methods the products lack: judges from a different model family than
  the teacher (preference leakage), human-corrected scores (prediction-powered inference), exact
  intervals for small test sets, conformal deferral thresholds, flip rate after precision changes,
  label-free drift alarms.

## Decision

1. ModelStill ships as an open-source Python library, `modelstill`, usable without any service:
   `pip install modelstill`. The library is the product; the dashboard and services are optional.
2. The library is organised around the loop, each part usable alone:
   - `modelstill.spec` - one strict task file per task.
   - `modelstill.evals` - benchmarks, metrics, judges, judge calibration against human labels,
     scores with intervals, run comparison, run history. This is the first part to make excellent,
     because it is the part teams can adopt without training anything.
   - `modelstill.data` - datasets from logs with provenance, labelling by several teachers,
     disagreement queues, versioned splits.
   - `modelstill.train` - training through pluggable backends (TRL first). ModelStill does not
     reimplement training.
   - `modelstill.gate` - release decisions with every check stored.
   - `modelstill.serve` - confidence-based deferral to a cloud fallback, logging both answers.
   - `modelstill.monitor` - canaries, drift alarms, retraining triggers.
3. Everything external is a plugin behind a small protocol: teachers and judges (LiteLLM by
   default), training backends, serving backends (vLLM), stores (local files and SQLite by
   default; Postgres and ClickHouse for the hosted setup), sources (Langfuse, JSONL).
4. Application-specific data access and tasks live in an adapter package outside the core. The
   first production user keeps its adapter in its own repository.
5. The website, dashboard and API are a reference deployment of the library, not the product.

## Consequences

- The core library must stay light: no GPU, cloud or database dependency in `pip install
  modelstill`. Heavy pieces are optional extras (`modelstill[train]`, `modelstill[litellm]`).
- Public API stability matters from the first release; breaking changes need a decision record.
- The evaluation library comes before training and serving in the build order.
- No standalone revenue is assumed. A hosted or enterprise layer is a later decision, taken only if
  adopters ask for it.

## Alternatives considered

- Internal platform only (the first plan): useful for one application, but no value to other teams.
- Hosted text-to-model product: late; clouds and funded vendors already sell it and buyer search
  demand is near zero.
- Building on an existing end-to-end fine-tuning framework: the one evaluated had a heavy install
  and returned no log-probabilities from its inference engines.

## Notes moved from code

Reasons that used to live in comments and docstrings of the core library.

- `stats.py`: test sets hold a few hundred items, where the normal approximation gives intervals
  that are too narrow, so binomial proportions use Wilson or exact Clopper-Pearson intervals. The
  deferral threshold is searched from the most confident cut-off down and stops at the first
  failure (fixed-sequence testing), which keeps the guarantee without correcting for the number of
  candidates; cut-offs accepting fewer items than could ever pass with zero errors are skipped, and
  that size depends only on `target_error` and `delta`, never on the data.
- `evals.py`: two runs are compared case by case because a paired comparison detects real
  differences that two separate intervals hide. F1 is pooled over every item because averaging F1
  per case rewards answering nothing whenever many cases are empty; a failed case counts as an empty
  answer. A model failure is a scored outcome, not a crash (the `BLE001` suppression).
- `gate.py`: the quality check reads the lower end of the run's interval, not the point score, so a
  small or lucky test set cannot carry a weak model through.
- `judges.py`, `spec.py`: judges favour models trained on their own family's outputs, so a panel
  never repeats a family and never includes a teacher's family. Spec keys are strict at every level
  so a typo can never silently fall back to a default.
- `data.py`: item identity is the SHA-256 of the input as canonical JSON, so a split never depends
  on file order; splits hash the seed with the input hash (or the group, such as one source whose
  records share a template) so near-copies cannot sit on both sides and adding items never moves
  existing ones. Datasets are append-only JSONL: a later record supersedes an earlier one. One
  teacher failure is recorded on its item and never stops the batch (the `BLE001` suppression).
- `push.py`, `client.py`: standard library only so the core stays light, with an injectable opener
  so tests never touch the network. History run ids are sent as UUIDs and gate ids are derived from
  the gate's inputs, so pushing the same thing twice is a no-op.
