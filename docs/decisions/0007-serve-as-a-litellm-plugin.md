# 0007. Serve as a LiteLLM custom provider instead of a separate gateway

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** maintainers
- **Supersedes:** decision 1 of [ADR 0004](0004-gateway-and-monitoring.md) (the Starlette gateway)

## Context

Many applications already send every task through a LiteLLM proxy; the first production user does
(v1.101.0). That proxy handles keys, budgets, retries, timeouts, fallbacks, the response cache and
traces. A second proxy in front of it would add a network hop, a second service to run and a second
place to configure keys. LiteLLM also ships a shadow-traffic feature: it is judged by an LLM, not
by the task's own metric, but it shows the proxy is the place where this kind of routing belongs.

## Decision

1. ModelStill routes requests from inside the proxy as a LiteLLM custom provider,
   `modelstill.serve.litellm_plugin.ModelStillProvider`. It is installed with
   `modelstill[litellm]`, pinned to `litellm==1.101.0`.
2. A task keeps its LiteLLM name, so callers change nothing.
   - `<task>` points at `modelstill/<task>`.
   - The cloud deployment it replaces moves to `<task>-cloud`.
   - The plugin calls `<task>-cloud` through the proxy's own router, so retries, timeouts,
     fallbacks and provider keys stay in `config.yaml`.
3. The routing code (`Router`, modes off, shadow and serve, deferral reasons), deployment files and
   event sinks are unchanged. The Starlette server, `modelstill serve run` and the `serve` extra
   are removed.
4. Pricing. The response carries the answering model's token usage, and the `<task>` deployment
   carries the cloud model's `model_info` prices, so key budgets keep working. A student answer is
   priced at cloud prices, which overstates spend and never hides it.
5. Failure is never worse than before. The plugin reads its config on first use, not at import. A
   missing or broken config, an unknown task or a cloud failure raises an error, and LiteLLM's
   fallback for the task (`<task>-fallback`) answers.

## Consequences

- Shipping the plugin means a LiteLLM image with the wheel installed (`deploy/litellm/Dockerfile`).
  The plugin needs only pydantic and PyYAML, both already in the proxy, so it installs with
  `--no-deps`.
- The proxy's response cache sits in front of the plugin. Cache hits produce no serving event,
  so the shadow comparison covers uncached calls only.
- The inner call to `<task>-cloud` is not attached to the caller's key. It shows up in the proxy's
  global spend and in its traces, not in the key's spend.
- There is no `/health` endpoint. `ModelStillProvider.health()` exists for tests and debugging,
  and the traffic screen on the dashboard shows the live state.
- Streaming is refused, as before.

## Alternatives considered

- Keep the Starlette gateway: one more service and hop, with keys and fallbacks configured twice.
- A CustomLogger hook only: it can log and sample, but it cannot replace the answer, so no serve mode.
- LiteLLM's shadow evaluation: an LLM-judge win rate, not exact-match or F1 against the stored
  answers.

## Links

- Code: `python/modelstill/src/modelstill/serve/litellm_plugin.py`, `deploy/litellm/`
- Runbook: `../runbooks/serving-and-monitoring.md`
