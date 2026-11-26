# Contributing

Thank you for helping. The rules for working in this repository are in [AGENTS.md](AGENTS.md);
they apply to people and to coding agents alike. The short version:

- **Tests first.** Write a failing test, make it pass, then tidy. Tests are fast and isolated: no
  live network, GPU, database or model provider.
- **No comments in code.** Names and tests carry the meaning. Reasons that outlive the change go
  in an ADR (`docs/decisions/`) or a runbook (`docs/runbooks/`).
- **Exact pins.** Dependencies are pinned to exact versions. Upgrades of the training and serving
  stack need an ADR.
- **No private data.** No production data, prompts, customer names, internal host names or secrets
  in code, docs, tests or commit messages. CI checks for the obvious cases.

## Setup

```bash
docker compose up -d
bun install
cd python/modelstill && uv sync --extra dev
```

## Before you open a pull request

Run the checks for what you touched:

```bash
bun run test && bun run typecheck && bun run lint
cd python/modelstill && uv run ruff format --check && uv run ruff check && uv run basedpyright && uv run pytest
```

Fill in the pull request template. Changes to scoring, thresholds or serving should link a gate
report.

## Licence

By contributing you agree that your contribution is licensed under the Apache License 2.0, the
licence of this repository.
