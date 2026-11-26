# @modelstill/clickhouse-failover

One `query()` over a list of ClickHouse hosts, for readers that are handed a comma-separated host
list in one environment variable. The rules were first worked out in a production search
service that reads from several ClickHouse replicas.

## Behaviour

- **Order.** `order: "preferred"` (the default): the first host answers everything while it can, the
  others only when it fails as a host. `order: "round-robin"`: each query starts on the next host.
  The whole order is fixed when a query starts and the retry walks it, so concurrent queries moving
  the round-robin counter cannot send a retry back to the host that just failed.
- **When another host is tried.** Only when a host fails *as a host*: connection refused, a replica
  that cannot serve its tables, or a body that dies mid-stream. A query's own errors and anything
  after the caller's abort are thrown as they are.
- **Resets.** A connection cut under a request that reached the host (reset, hang up, a body that
  stopped) says nothing lasting about the host: a stale keep-alive socket or one dropped packet does
  the same. The same host is asked once more before any other.
- **Cooldown.** A host that failed is tried last for the cooldown only once a later host answered
  the same query; that answer is what shows the failure was the host's. Hosts that failed and are not
  marked yet are held as `unconfirmed`: marked when a later host answers, forgotten when none does.
  When every host fails, nothing is marked and the first error is thrown, so a statement that is
  wrong everywhere costs one round of the list and moves no later read. A marked host is never
  skipped outright, so a host that recovers sooner is found as soon as the others fail.
- **Params.** The params object reaches each host untouched, so the statement and its settings, which
  key the server's query cache, stay the caller's. Every other method (insert, command, exec, ping)
  goes to the first host; `close()` closes them all. A list of one is returned as it is.
- **Logging.** Each client has a name for the log line (defaults to its index); never a URL, which
  holds a password. Hosts are logged by host:port only. The clock is injectable for tests.

## Exceptions written into the body

A query that dies mid-stream leaves its exception in the body: for JSONEachRow a row
`{"exception": "Code: 159. DB::Exception: ..."}`, for a raw format that text on a line of its own.
The client reads it as an error only when the response carries the exception header, which this
server does not send, so without the guard it would come back as a row.

The guard matches the server's own marker and nothing else: an object whose only key is
`exception`, holding text in ClickHouse's `Code: NNN. DB::Exception:` shape. A result row that has a
string column named `exception` (model-written SQL may select one) stays a row. The server writes the
marker where the next row would be and then stops, so only the last row is checked. Wrapping a
guarded client returns it unchanged.

## Replica-level error codes

These codes say the replica is unusable, not the query: 60 UNKNOWN_TABLE, 81 UNKNOWN_DATABASE,
231 TOO_MANY_UNEXPECTED_DATA_PARTS, 232 NO_SUCH_DATA_PART, 234 NO_REPLICA_HAS_PART, 246
CORRUPTED_DATA, 695 ASYNC_LOAD_FAILED, 696 ASYNC_LOAD_CANCELED and 722 (the table load failure seen
beside 696 and 231). Another replica has the same data and answers.

Anything else (41 parse, 62 syntax, 159 timeout, 202 too many queries, 241 memory, 394 cancelled)
belongs to the query: it would fail the same way everywhere, or would only move load onto a replica
not sized for it.

60 and 81 are also what a statement naming a table that exists nowhere gets (model-written SQL
does this), so a code alone never marks a host; see the cooldown rule above.

The error code is read from a `ClickHouseError` (`code` is a digit string) or from the `Code: NNN.`
prefix on a plain message. It is null when the error is not ClickHouse's: a transport `code` is a
string such as `ECONNREFUSED`, and an ingress body has no `Code:` marker. When ClickHouse answered
with a code, the code alone decides; otherwise the transport decides.

## Transport failures

The socket failed under the request: refused, reset, unresolvable, or closed before the body was
read. The error `code` is checked first because Bun's `node:http` reports every reset as
`code: "ECONNRESET"` under a message that carries none of Node's words; the message pattern keeps
Node's shapes ("read ECONNRESET", "socket hang up", "Premature close", "aborted") working.

## Building from a URL list

The entries of a comma-separated URL list are parsed once. An entry holds a password, and the
runtime's own "invalid URL" error quotes its input, so a bad entry is reported by its position
alone and the original error is dropped, never chained. `build` makes the client for each entry, so
the caller keeps its own settings and timeouts.
