## Summary

<!-- What changes and why. -->

## Checklist

Tick what applies; strike through (`~~text~~`) or write "n/a" for what does not.

- [ ] Tests: a failing test drove the change, and the full suite of every touched app passes
- [ ] ADR in `docs/decisions/` for a decision with lasting consequences; runbook in `docs/runbooks/` for a new operational procedure
- [ ] Gate: any change to scoring, thresholds or serving re-ran the gate and the report is linked
- [ ] Pinned dependencies (TRL, transformers, vLLM, LiteLLM) changed only through an ADR
- [ ] Reads from a production database use read-only credentials and explicit limits (ClickHouse `SETTINGS`)
- [ ] No secrets, customer names or customer data in code, docs or commit messages

## Deploy notes

<!-- Order of operations, migrations, rollout mode changes, rollback. -->
