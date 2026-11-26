# @modelstill/telemetry and @modelstill/utils

## telemetry

Usage and environment variables are in `packages/telemetry/README.md`.

It is built on the base OpenTelemetry SDK rather than `@opentelemetry/sdk-node` with
auto-instrumentations: the services run under Bun, where the auto-instrumentations' module
patching never fires (verified 2026-09-22), while the context manager, propagator and
exporter work. The few spans that matter are started explicitly with `withSpan`, and the ids cross
Redis and RabbitMQ as a W3C `traceparent` field on the payload (`inject` / `extract`).

With `OTEL_ENABLED` unset every helper still runs: spans are non-recording, `inject()` is `{}`,
`currentTraceIds()` is undefined, and nothing is sent anywhere.

| Name | Meaning |
|---|---|
| `spanProcessor` option | Test seam: a processor in place of the OTLP exporter; tracing is then on regardless of env |
| `exporter` field | Where spans go when enabled from the environment; undefined for a test processor |
| `shutdown()` | Flushes pending spans and unregisters the globals, so a later `startTelemetry` can register again |
| `withSpan` | Runs `fn` inside a new active span. A thrown error marks the span, is recorded on it and is rethrown; the span always ends |
| `inject()` | The W3C headers for the active span, to put on a payload that crosses a process boundary |
| `extract()` | The context a payload's `traceparent` describes; the root context when there is none |
| `currentTraceIds()` | The active span's ids in the field names the log lines use; undefined outside any span |

## utils: environment

`RABBITMQ_SEARCH_URI` is an optional second broker for RPC calls. Unset means those calls share
`RABBITMQ_URI` (local dev, staging). A key present but empty in the Secret reads as unset rather than failing the
parse, because bootstrap must not die on it.
