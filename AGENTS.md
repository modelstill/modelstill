# ModelStill - contributor and agent guidelines

These rules apply to humans and AI agents working anywhere in this monorepo. Start with
[README.md](README.md) for the repository map.

## Where knowledge goes

The repository is the system of record. Durable knowledge belongs in the repo, not in AI memory or
chat logs.

| You did or learned | Write it in |
|---|---|
| A decision with lasting consequences (schema shape, a new service or vendor, a pinned dependency upgrade) | `docs/decisions/NNNN-slug.md` from `docs/decisions/0000-template.md` |
| An operational procedure (deploy, rollout, rollback, retrain) | `docs/runbooks/` |
| Something broke in production | `docs/incidents/YYYY-MM-DD-slug.md` |

## Workflow - TDD always
Strict test-driven development, no exceptions:
1. **Red** - write a failing test that describes the behavior before any implementation. Run it and
   confirm it fails for the right reason.
2. **Green** - write the minimum code to pass it.
3. **Refactor** - clean up while keeping tests green.

- No production code is written or changed without a failing test driving it.
- Bugs start with a test that reproduces them.
- Tests live next to their code: `python/modelstill/tests/`, `apps/<ts-app>/test/`.
- The core library stays light: nothing in `pip install modelstill` may need a GPU, a cloud account
  or a database. Heavy pieces are optional extras.
- Run the full suite of every app you touched before calling a task done.
  Python: `uv run --extra dev pytest` in `python/modelstill`. TypeScript: `bun run test` at the root.
- Tests are fast and isolated: no live network, GPUs, ClickHouse, Postgres or model providers. Stub
  them. GPU and provider checks run in separate, explicitly marked smoke jobs.

## Statistics and gates
- Every reported score carries an interval. Small test sets (a few hundred items) use exact or
  Bayesian intervals, never the normal approximation.
- The judge of a model never shares a model family with the teacher that labelled its training data.
- A gate decision is stored with every threshold and measured value, so it can be re-read later.

## Serving
- Every adapter or model artifact lives at an immutable, versioned path. Never overwrite a path in
  place: serving caches key on it.
- The gateway checks the model that actually answered on every call and defers to the cloud model
  on a mismatch.
- The gateway logs both answers whenever both exist; deferred answers are training data.

## Data from production systems
- Production data is read through read-only credentials only. Every ClickHouse read carries explicit
  `SETTINGS` (`max_memory_usage`, `max_threads`, `max_execution_time`).
- Production data, prompts and customer content never enter this repository. Application-specific
  adapters, task folders and experiment logs live in the application's own private repository.
- Teacher models are chosen only after checking that the provider's terms allow training on their
  outputs. Record the check in the task's ADR.

## Dependencies
- TRL, transformers, vLLM and LiteLLM are pinned to exact versions. Upgrades go through an ADR and a
  full gate re-run.
- No AGPL or proprietary code is copied into this repository. Apache-2.0 code copied from other
  projects keeps its licence and notices (see `NOTICE`).

## Code style

### Python (python/modelstill)
- `ruff check`, `ruff format --check` and `basedpyright` must pass.
- All imports at the top of the module, except `if TYPE_CHECKING:` blocks.
- No comments or docstrings in code, config or deploy files (owner decision, 24 Nov 2026). Code
  documents itself through names and small functions; every reason (a pin, a measured number, a
  safety choice) goes in an ADR or runbook under `docs/`.
- Suppressions name the rule (`# noqa: PLC0415`, `# pyright: ignore[rule]`); the reason lives in the
  docs. No blanket `# noqa` or `# type: ignore`.

### TypeScript / JavaScript
- Never use `//` or `/* */` comments. Code documents itself through names and small functions.
  A hook in `.claude/hooks/` enforces this, except under `vendor/` folders that hold copied code
  with its original notices.
- Type-check with `bunx turbo typecheck` before done.

## Privacy
Never commit secrets, API keys, tokens, passwords, customer names or customer data. Reference
secrets by their Kubernetes secret or environment variable name only.
