# @modelstill/telemetry

OpenTelemetry traces for the TypeScript services, exported to Axiom (`modelstill-traces`) over
OTLP/HTTP. Manual spans on the base SDK: the auto-instrumentations do not patch modules under Bun,
so there is no `@opentelemetry/sdk-node` here and adding one gains nothing.

```ts
import { startTelemetry, withSpan, inject, extract, runInContext, SpanKind } from "@modelstill/telemetry";

const telemetry = startTelemetry({ serviceName: process.env["SERVICE_NAME"] ?? "modelstill-api" });

await withSpan("jobs.request", { kind: SpanKind.CLIENT, attributes: { "modelstill.job_id": id } }, async () => {
  publish({ ...envelope, ...inject() });          // traceparent on the payload
});

// the other side of the hop
await runInContext(extract({ traceparent: payload.traceparent }), () =>
  withSpan("jobs.relay", {}, async (span) => { span.setAttribute("modelstill.outcome", "ok"); }),
);

process.on("SIGTERM", () => void telemetry.shutdown());   // flushes the batch
```

Environment: `OTEL_ENABLED=true`, `AXIOM_OTEL_TOKEN` (falls back to `AXIOM_TOKEN`),
`OTEL_TRACES_SAMPLE_RATIO` (root sampling, default 0.1; children follow the parent),
`AXIOM_TRACES_DATASET` (default `modelstill-traces`), `AXIOM_OTEL_ENDPOINT` (default
`https://api.axiom.co`). Off, every helper is a no-op: `inject()` is `{}` and spans record nothing.

Tests pass a `spanProcessor` (an `InMemorySpanExporter` behind a `SimpleSpanProcessor`); that turns
tracing on with a 1.0 ratio regardless of env. `shutdown()` unregisters the globals so the next test
can start again.

The pino `mixin` that puts `trace_id`/`span_id` on log lines lives in `@modelstill/logger`
(`traceMixin`), which depends on `@opentelemetry/api` only. Decision record: `docs/decisions/0020`.
