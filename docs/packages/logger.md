# @modelstill/logger

## flush

`flush()` resolves once pino has handed every buffered line to its transports (stdout, Axiom).

## Process guards

Bun ends the process with exit code 1 on an unhandled promise rejection once the entry module has
finished evaluating, unless an `unhandledRejection` listener exists. A long-running server has
promises nobody awaits by design (postgres.js re-fetches array types on every reconnect and never
awaits it; fire-and-forget hooks), so in one production incident a rejected promise during a
Postgres or PgBouncer blip took every api pod down and crash-looped it until the database was back.

`installProcessGuards` logs the error as a structured line, hands it to `report` (Sentry) and keeps
serving. An uncaught exception still ends the process, after the same line and a bounded `flush`,
so the restart is visible in the logs and in Sentry.

| Option | Meaning |
|---|---|
| `report` | Error reporting hook (Sentry). Errors it throws are swallowed, so reporting never adds a second failure |
| `flush` | Awaited, at most `FLUSH_MS`, before an uncaught exception exits: Sentry and log transports |
| `exit` | Called after an uncaught exception is logged and flushed; defaults to `process.exit(1)` |
| `proc` | The emitter to listen on; defaults to `process` |

Constants: `STACK_LINES` is how many lines of a stack trace a guard logs, `CAUSE_DEPTH` how deep
`cause` chains are followed, `FLUSH_MS` the longest an exiting process waits.

A logged error carries name, message, a stack head, the error's own enumerable fields (postgres.js
puts `code`, `severity`, `routine` and friends there) and the `cause` chain.

### Why the first test spawns a child

The test checks the reason the guards exist: a child process starts a server, rejects a promise
once it is listening, then asks its own server for a page and prints a line when the answer
arrives. Without the guards the line never prints. Nothing in it waits on a clock: Bun reports the
rejection before it reads the socket, while a timer that is already due when the rejecting callback
returns runs first, which is how a stalled runner once let the clean exit win. If Bun ever changes
this default, the first test fails and the guards can be reconsidered.

## traceMixin

A pino mixin that puts the active OpenTelemetry span's trace id on every line, under the name the
Python logs and the Axiom correlation group use (`trace_id`). Only `@opentelemetry/api` is needed:
with no tracer provider registered (tests, a service started without telemetry) there is never an
active span and the mixin adds nothing. pino merges the call site's object over the mixin's, so a
line that names its own `trace_id` keeps it.

It deliberately does not add `span_id`: Axiom caps the number of columns in a dataset, and once a
dataset is near the cap an event with a field it has never seen is rejected whole at ingest. The
trace view joins on `trace_id` alone.

The test builds a pino logger whose lines land in an array, with the mixin under test installed.
