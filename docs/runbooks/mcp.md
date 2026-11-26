# MCP server

`apps/mcp` lets an MCP client (Claude Code, Claude, Cursor) read ModelStill tasks, evals, gates,
review queues, serving and training runs, decide review items, and change a task's serving mode.
It holds no data and no database connection: every tool is one or two HTTP calls to the ModelStill
API with the caller's own credential. Decision: [ADR 0013](../decisions/0013-mcp-server.md).
Code: `apps/mcp/src/`.

## Run it locally

```bash
cd apps/api && bun run dev
cd apps/mcp && bun run dev
curl -s localhost:3104/healthz
```

| Variable | Default | What it is |
|---|---|---|
| `MODELSTILL_API_URL` | `http://localhost:8787` | The API every tool calls, and where OAuth tokens are checked (`/api/auth/mcp/get-session`) and discovery metadata is read (`/api/auth/.well-known/*`). |
| `PUBLIC_URL` | `http://localhost:$PORT` | The URL clients reach this server at. It goes into `WWW-Authenticate` and into the protected-resource metadata as `resource`, so in production it must be the public origin (for example `https://mcp.modelstill.com`). |
| `PORT` | `3104` | Listen port. |
| `MCP_UNAUTH_LIMIT` | `30` | Refused requests (no or invalid credentials) allowed per client IP per window before `/mcp` answers 429. `0` turns the limiter off. |
| `MCP_UNAUTH_WINDOW_SECONDS` | `60` | The limiter window. |
| `MCP_DOCS_URL` | `$PUBLIC_URL/docs` | Where 401 bodies and the protected-resource metadata point people. `/docs` on this server answers a plain-text setup guide. |

Docker: `docker build -f apps/mcp/ci/Dockerfile -t modelstill-mcp .` from the repo root, then
`docker run -p 3104:3104 -e MODELSTILL_API_URL=http://host.docker.internal:8787 modelstill-mcp`.
The image holds only the bundled `dist/index.js` and runs as the `bun` user.

## Credentials

- A ModelStill API key (`ms_live_...`) in `Authorization: Bearer` or `x-api-key` is passed to the
  API unchecked; the API decides what it may do.
- Anything else in `Authorization: Bearer` is an OAuth access token from the Better Auth MCP plugin.
  It is checked once per request at `GET $MODELSTILL_API_URL/api/auth/mcp/get-session`, which must
  answer 200 with a JSON body carrying a non-empty `userId`. The token is then forwarded to the API.
- A refusal is 401 with `WWW-Authenticate: Bearer realm="modelstill", resource_metadata="$PUBLIC_URL/.well-known/oauth-protected-resource"`
  and `{error, hint, docs_url}`. That header is what starts the OAuth flow in Claude and Claude Code.
- Until the API answers `/api/auth/mcp/get-session`, only `ms_live_` keys get through. The API's
  older static `MODELSTILL_API_TOKEN` does not start with `ms_live_`, so it is treated as an OAuth
  token and refused.

## Connect a client

Claude Code:

```bash
claude mcp add --transport http modelstill http://localhost:3104/mcp --header "Authorization: Bearer ${MODELSTILL_API_KEY}"
```

Project `.mcp.json` (Claude Code expands `${MODELSTILL_API_KEY}` from the environment):

```json
{
  "mcpServers": {
    "modelstill": {
      "type": "http",
      "url": "http://localhost:3104/mcp",
      "headers": { "Authorization": "Bearer ${MODELSTILL_API_KEY}" }
    }
  }
}
```

Cursor: the same `mcpServers` block in `~/.cursor/mcp.json` or the project's `.cursor/mcp.json`.
With OAuth instead of a key, leave out `headers`; the client follows the 401 to the API's sign-in.

## Tools

| Tool | Kind | Returns |
|---|---|---|
| `list_tasks` | read | Every task: slug, version, snapshot hash, mode, deferral share, last gate result. |
| `get_task` | read | One task with all its versions. |
| `list_eval_runs` | read | Eval runs, newest first, mean with 95% interval and every metric. |
| `compare_runs` | read | Paired difference of two runs with its bootstrap interval, verdict, fixed and broken counts, number of paired cases. The per-case list is left out. |
| `list_gates` | read | Gate decisions with every check: threshold, measured value, passed. |
| `get_review_queue` | read | Items waiting for a human, with teacher outputs and agreement. |
| `get_deployment` | read | Mode (`off`, `shadow`, `serve`), student model, threshold, target error, shadow sample, active since. |
| `get_traffic` | read | Hourly totals served by the student, deferred, mismatched, p95 latencies, the deferral share and window totals. |
| `list_canaries` | read | Canary runs: provider, passed of total, interval. |
| `list_alerts` | read | Alerts: kind, severity, fired, acknowledged, payload. |
| `list_train_runs` | read | Training runs: key, base, method, status, final metrics, times. |
| `get_train_run` | read | One run with each metric series summarised: points, first, last, best (lowest for losses, highest for rewards and accuracies). |
| `decide_review_item` | write | Accept an item or correct it with `corrected_output`. |
| `set_deployment_mode` | write | Set mode `off`, `shadow` or `serve`. Rollback is mode `off`. |

## Behaviour worth knowing

- Every tool refuses arguments it does not declare, naming the one it most likely meant, before
  any API call.
- Reads answered 429 are retried: at most 3 attempts, each waiting `Retry-After` capped at 2 s
  (1 s when absent), never more than 8 s in all. Writes are sent exactly once; a failed write comes
  back to the agent with `retryable` and, on 429, `retry_after`.
- Failures answer `isError: true` with `{error, message, next_step, retryable}`.
- `set_deployment_mode` reads the current deployment and sends it back with only the mode and the
  fields the call names changed, because `PUT /v1/tasks/{slug}/deployment` replaces the whole
  record and would otherwise reset the student model and threshold to null. It refuses `shadow` or
  `serve` without a student model, and a first `shadow` or `serve` without `target_error`. A first
  `off` with no deployment stores target error 0.05, which nothing reads while the task is off.
- `decide_review_item` records `reviewer` as `modelstill-mcp` when the call names nobody.
- `get_train_run` picks the better direction from the metric name: `loss`, `error`, `perplexity`
  are lower-is-better; `reward`, `acc`, `f1`, `score`, `precision`, `recall`, `exact` are
  higher-is-better; any other metric (learning rate, grad norm) gets `best: null`.
- The protected-resource document is the API's, with `resource` replaced by `PUBLIC_URL`: clients
  check that the resource covers the URL they connected to, and the API cannot know it.

## Tests

`bun test` in `apps/mcp`. `test/harness.ts` drives the real server through the SDK client over an
in-memory transport and calls `listTools` first, so output schemas are checked the way a real
client checks them. `test/stub.ts` replaces the API with a recorded fetch; no test reaches the
network.
