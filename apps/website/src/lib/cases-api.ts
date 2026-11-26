import { z } from "zod";
import { ApiError, ApiUnreachableError, apiBaseUrl, type ApiClientOptions } from "./api";

const metadataSchema = z.record(z.string(), z.unknown());

const datasetVersionSchema = z.object({
  number: z.number(),
  hash: z.string(),
  parent: z.number().nullable(),
  rowCount: z.number(),
  change: z.object({ kind: z.enum(["create", "import", "add", "edit", "delete"]), rowIds: z.array(z.string()) }),
  author: z.string().nullable(),
  createdAt: z.string(),
});
export type DatasetVersion = z.infer<typeof datasetVersionSchema>;

const caseRowSchema = z.object({
  id: z.string(),
  input: z.unknown(),
  expected: z.unknown(),
  metadata: metadataSchema,
  version: z.number(),
  position: z.number(),
});
export type CaseRow = z.infer<typeof caseRowSchema>;

const snapshotSchema = z.object({ name: z.string(), head: z.number(), version: datasetVersionSchema, rows: z.array(caseRowSchema) });
export type DatasetSnapshot = z.infer<typeof snapshotSchema>;

const summarySchema = z.object({ name: z.string(), createdAt: z.string(), head: datasetVersionSchema });
export type DatasetSummary = z.infer<typeof summarySchema>;

const revisionSchema = z.object({
  rowId: z.string(),
  version: z.number(),
  deleted: z.boolean(),
  input: z.unknown(),
  expected: z.unknown(),
  metadata: metadataSchema,
  author: z.string().nullable(),
  createdAt: z.string(),
});
export type RowRevision = z.infer<typeof revisionSchema>;

const writeSchema = z.object({ version: datasetVersionSchema, rows: z.array(caseRowSchema) });
export type DatasetWrite = z.infer<typeof writeSchema>;

export type NewCase = { id?: string; input: unknown; expected?: unknown; metadata?: Record<string, unknown> };

export type RowEdit = { input?: unknown; expected?: unknown; metadata?: Record<string, unknown> };

const servedRequestSchema = z.object({
  id: z.string(),
  ts: z.string(),
  task: z.string(),
  deploymentId: z.string(),
  requestHash: z.string(),
  mode: z.string(),
  servedFrom: z.string(),
  deferred: z.boolean(),
  reason: z.string().nullable(),
  confidence: z.number().nullable(),
  answeredBy: z.string().nullable(),
  studentModel: z.string().nullable(),
  modelMatch: z.boolean().nullable(),
  studentOutput: z.string().nullable(),
  cloudModel: z.string().nullable(),
  cloudOutput: z.string().nullable(),
  latencyMs: z.number().nullable(),
  studentMs: z.number().nullable(),
  cloudMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  studentCostUsd: z.number().nullable(),
  cloudCostUsd: z.number().nullable(),
});
export type ServedRequest = z.infer<typeof servedRequestSchema>;

const requestPageSchema = z.object({
  requests: z.array(servedRequestSchema),
  nextCursor: z.string().nullable(),
  requestBodyStored: z.boolean(),
});
export type RequestPage = z.infer<typeof requestPageSchema>;

export class ApiBodyError extends ApiError {
  readonly body: unknown;

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message, status, url);
    this.name = "ApiBodyError";
    this.body = body;
  }
}

export type CasesApi = ReturnType<typeof createCasesApi>;

export function createCasesApi(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? apiBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request<S extends z.ZodTypeAny>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, credentials: "include", headers: { accept: "application/json", ...init?.headers } });
    } catch {
      throw new ApiUnreachableError(baseUrl);
    }
    if (response.status === 401) options.onUnauthorized?.();
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
      throw new ApiBodyError(`HTTP ${response.status} from ${url}${detail ? `: ${detail}` : ""}`, response.status, url, body);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(`unexpected response from ${url}: ${parsed.error.issues[0]?.message ?? "invalid"}`, response.status, url);
    }
    return parsed.data;
  }

  const send = (method: string, payload: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const datasets = (slug: string) => `/v1/tasks/${encodeURIComponent(slug)}/datasets`;
  const dataset = (slug: string, name: string) => `${datasets(slug)}/${encodeURIComponent(name)}`;
  const rowPath = (slug: string, name: string, rowId: string) => `${dataset(slug, name)}/rows/${encodeURIComponent(rowId)}`;
  const versionQuery = (version?: number) => (version === undefined ? "" : `?version=${version}`);

  return {
    baseUrl,
    listDatasets: async (slug: string): Promise<DatasetSummary[]> =>
      (await request(datasets(slug), z.object({ datasets: z.array(summarySchema) }))).datasets,
    getDataset: async (slug: string, name: string, version?: number): Promise<DatasetSnapshot> =>
      (await request(`${dataset(slug, name)}${versionQuery(version)}`, z.object({ dataset: snapshotSchema }))).dataset,
    listVersions: async (slug: string, name: string): Promise<DatasetVersion[]> =>
      (await request(`${dataset(slug, name)}/versions`, z.object({ versions: z.array(datasetVersionSchema) }))).versions,
    rowHistory: async (slug: string, name: string, rowId: string): Promise<RowRevision[]> =>
      (await request(`${rowPath(slug, name, rowId)}/history`, z.object({ revisions: z.array(revisionSchema) }))).revisions,
    createDataset: async (slug: string, name: string, rows: NewCase[] = []): Promise<DatasetSnapshot> =>
      (await request(datasets(slug), z.object({ dataset: snapshotSchema }), send("POST", { name, rows }))).dataset,
    addRows: async (slug: string, name: string, rows: NewCase[], extra: { source?: "import" | "add"; baseVersion?: number } = {}): Promise<DatasetWrite> =>
      request(`${dataset(slug, name)}/rows`, writeSchema, send("POST", { rows, ...extra })),
    editRow: async (slug: string, name: string, rowId: string, baseVersion: number, edit: RowEdit): Promise<DatasetWrite> =>
      request(rowPath(slug, name, rowId), writeSchema, send("PATCH", { baseVersion, ...edit })),
    deleteRow: async (slug: string, name: string, rowId: string, baseVersion: number): Promise<DatasetWrite> =>
      request(`${rowPath(slug, name, rowId)}?baseVersion=${baseVersion}`, writeSchema, { method: "DELETE" }),
    exportUrl: (slug: string, name: string, version: number) => `${baseUrl}${dataset(slug, name)}/export?version=${version}`,
    listRequests: async (search: string): Promise<RequestPage> => request(`/v1/requests?${search}`, requestPageSchema),
  };
}
