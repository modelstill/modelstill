export interface Issue {
  message: string;
  path: (string | number)[];
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues?: Issue[],
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "UpstreamError";
  }
}

export interface Timing {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const realTiming: Timing = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface ApiOptions {
  baseUrl: string;
  credential: string;
  fetch?: typeof fetch;
  timing?: Timing;
}

const MAX_READ_ATTEMPTS = 3;
const MAX_READ_WAIT_MS = 8_000;
const MAX_RETRY_WAIT_MS = 2_000;
const DEFAULT_RETRY_WAIT_MS = 1_000;

function retryAfterSeconds(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function retryWaitMs(res: Response): number {
  const seconds = retryAfterSeconds(res);
  return seconds === undefined ? DEFAULT_RETRY_WAIT_MS : Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function errorFrom(res: Response): Promise<UpstreamError> {
  const body = asRecord(await parseBody(res));
  const code = typeof body["error"] === "string" ? body["error"] : `upstream_${res.status}`;
  const issues = Array.isArray(body["issues"]) ? (body["issues"] as Issue[]) : undefined;
  return new UpstreamError(res.status, code, issues, retryAfterSeconds(res));
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createApi(options: ApiOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timing = options.timing ?? realTiming;

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.credential}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new UpstreamError(502, "upstream_unreachable");
    }
  }

  async function read(path: string): Promise<unknown> {
    const deadline = timing.now() + MAX_READ_WAIT_MS;
    let res = await send("GET", path);
    for (let attempt = 1; res.status === 429 && attempt < MAX_READ_ATTEMPTS; attempt++) {
      const wait = retryWaitMs(res);
      if (timing.now() + wait > deadline) break;
      await timing.sleep(wait);
      if (timing.now() > deadline) break;
      res = await send("GET", path);
    }
    if (!res.ok) throw await errorFrom(res);
    return parseBody(res);
  }

  async function write(method: "POST" | "PUT", path: string, body: unknown): Promise<unknown> {
    const res = await send(method, path, body);
    if (!res.ok) throw await errorFrom(res);
    return parseBody(res);
  }

  const task = (slug: string, rest = "") => `/v1/tasks/${segment(slug)}${rest}`;

  return {
    listTasks: () => read("/v1/tasks"),
    getTask: (slug: string) => read(task(slug)),
    listVersions: (slug: string) => read(task(slug, "/versions")),
    listGates: (slug: string) => read(task(slug, "/gates")),
    listEvalRuns: (slug: string) => read(task(slug, "/eval-runs")),
    compareRuns: (before: string, after: string) =>
      read(`/v1/eval-runs/compare?${new URLSearchParams({ before, after })}`),
    reviewQueue: (slug: string, limit: number) =>
      read(task(slug, `/review-queue?${new URLSearchParams({ limit: String(limit) })}`)),
    decideReview: (itemId: string, body: Record<string, unknown>) =>
      write("POST", `/v1/review-queue/${segment(itemId)}/decision`, body),
    getDeployment: (slug: string) => read(task(slug, "/deployment")),
    setDeployment: (slug: string, body: Record<string, unknown>) => write("PUT", task(slug, "/deployment"), body),
    traffic: (slug: string, hours: number) =>
      read(task(slug, `/traffic?${new URLSearchParams({ hours: String(hours) })}`)),
    listCanaries: (slug: string) => read(task(slug, "/canaries")),
    listAlerts: (slug: string) => read(task(slug, "/alerts")),
    listTrainRuns: (slug: string) => read(task(slug, "/train-runs")),
    getTrainRun: (key: string) => read(`/v1/train-runs/${segment(key)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
