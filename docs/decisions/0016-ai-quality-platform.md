# 0016. ModelStill becomes an open-source, self-hosted AI quality platform

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** maintainers
- **Changes:** parts of [ADR 0001](0001-framework-first.md)

## Context

ADR 0001 made ModelStill a framework first, with the dashboard as a reference deployment and any
hosted layer out of scope. Evidence gathered since then:
- job postings;
- gateway logs of the first production user;
- search demand;
- funding and adoption data;
- direct reads of other evaluation tools.

That evidence points to AI quality (evaluation, monitoring and guardrails for LLM and agent systems)
as a large, growing, proven market. In it, ModelStill's differences hold: free self-hosting,
statistical proof, acting on findings, and watching endpoints.

## Decision

1. **Product.** ModelStill is an open-source, self-hosted AI quality platform. It proves a model or
   agent change is safe, watches the endpoint after release, and turns failures into a cheaper or
   better model. The dashboard is part of the product.
2. **Rules.** Every phase:
   - follows a growing, measured signal;
   - ships open source with no account and no telemetry;
   - differs in ways funded players are slow to copy;
   - ships something the first production user runs before it is released.
3. **Phases**, in this order:
   - 0: prove the improvement loop once;
   - 1: model swap check and endpoint watchdog;
   - 2: read what teams already have;
   - 3: agents and multi-turn;
   - 4: platform and public release;
   - 5: the improvement loop as a product, only after Phase 0 passes.

   Phase 0 is decided on one extraction task first. A judging task is added only if that fails.
4. **Open decisions, settled:**
   - **Tracing:** build on Langfuse and OpenTelemetry; do not build a trace store.
   - **Licence:** Apache-2.0 for the library, API, MCP server and dashboard, with no exceptions.
     The dashboard's motion components are our own, built on Motion (ADR 0015).
   - **Release:** the library after Phase 2, the platform after Phase 4.
   - **Hosted version:** not now. It is decided after the first outside installs.
5. **Messaging** uses the words people search for ("open source LLM evaluation framework", "LLM as
   a judge", "agent evaluation", "AI evals"), not "release gate", "distillation" or
   "fine-tuning platform". Self-hosting a small model does not pay on cost alone at low volume, so
   the case is quality and safety: gating changes and monitoring endpoints.

## Consequences

- ADR 0001's "reference deployment" wording no longer holds. The dashboard, API and MCP server are
  maintained as product.
- The dashboard uses only shadcn/ui and our own motion components on Motion (ADR 0015). Other UI
  libraries are removed.
- Competing with established evaluation and observability products is accepted. The test is
  outside installs within a month of the first release.
- If Phase 0's stop signal fires (a free general judge matches a trained one), "acts on what it
  finds" leaves the positioning and the other three differences carry it.

## Links

- Runbooks: `../runbooks/model-swap.md`, `../runbooks/serving-and-monitoring.md`,
  `../runbooks/ingest-and-import.md`
- Public documentation: `apps/docs/content/docs`
