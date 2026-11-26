import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { CallerVariables } from "../auth/caller.ts";
import { toJsonl, type CaseDatasetStore, type WriteFailure, type WriteResult } from "../datasets.ts";
import type { Store } from "../store.ts";

const SECURITY: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }];

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const DatasetName = z.string().regex(NAME_PATTERN, { message: "a dataset name is up to 64 letters, digits, dots, dashes and underscores" });

const Metadata = z.record(z.string(), z.unknown());

const ChangeKind = z.enum(["create", "import", "add", "edit", "delete"]);

const DatasetVersion = z
  .object({
    number: z.number().int(),
    hash: z.string().openapi({ description: "sha256 of the rows in the form python's Benchmark.version hashes them" }),
    parent: z.number().int().nullable(),
    rowCount: z.number().int(),
    change: z.object({ kind: ChangeKind, rowIds: z.array(z.string()) }),
    author: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("DatasetVersion");

const DatasetRow = z
  .object({
    id: z.string(),
    input: z.unknown(),
    expected: z.unknown(),
    metadata: Metadata,
    version: z.number().int().openapi({ description: "The dataset version that wrote this row as it is now" }),
    position: z.number().int(),
  })
  .openapi("DatasetRow");

const DatasetSnapshot = z
  .object({ name: z.string(), head: z.number().int(), version: DatasetVersion, rows: z.array(DatasetRow) })
  .openapi("DatasetSnapshot");

const DatasetSummary = z.object({ name: z.string(), createdAt: z.string(), head: DatasetVersion }).openapi("DatasetSummary");

const RowRevision = z
  .object({
    rowId: z.string(),
    version: z.number().int(),
    deleted: z.boolean(),
    input: z.unknown(),
    expected: z.unknown(),
    metadata: Metadata,
    author: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("RowRevision");

const present = (value: unknown) => value !== undefined && value !== null && value !== "";

const NewCase = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    input: z.unknown().refine(present, { message: "every case needs an input" }),
    expected: z.unknown().optional(),
    metadata: Metadata.optional(),
  })
  .openapi("NewCase");

const DatasetCreate = z
  .object({ name: DatasetName, rows: z.array(NewCase).max(10_000).default([]) })
  .openapi("DatasetCreate");

const RowsAppend = z
  .object({
    baseVersion: z.number().int().min(1).optional(),
    source: z.enum(["import", "add"]).default("add"),
    rows: z.array(NewCase).min(1).max(10_000),
  })
  .openapi("RowsAppend");

const RowPatch = z
  .object({
    baseVersion: z.number().int().min(1),
    input: z.unknown().optional(),
    expected: z.unknown().optional(),
    metadata: Metadata.optional(),
  })
  .refine((body) => body.input !== undefined || body.expected !== undefined || body.metadata !== undefined, {
    message: "change at least one of input, expected or metadata",
  })
  .refine((body) => body.input === undefined || present(body.input), { message: "input cannot be empty", path: ["input"] })
  .openapi("RowPatch");

const WriteResponse = z.object({ version: DatasetVersion, rows: z.array(DatasetRow) }).openapi("DatasetWrite");

const ErrorBody = z
  .object({
    error: z.string(),
    head: z.number().int().optional(),
    duplicates: z.array(z.object({ index: z.number().int(), id: z.string() })).optional(),
    issues: z.array(z.unknown()).optional(),
  })
  .openapi("DatasetError");

const SlugParam = z.object({ slug: z.string().openapi({ param: { name: "slug", in: "path" } }) });
const NameParam = SlugParam.extend({ name: DatasetName.openapi({ param: { name: "name", in: "path" } }) });
const RowParam = NameParam.extend({ rowId: z.string().min(1).openapi({ param: { name: "rowId", in: "path" } }) });

function json<T extends z.ZodTypeAny>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}

function body<T extends z.ZodTypeAny>(schema: T) {
  return { content: { "application/json": { schema } }, required: true };
}

const errors = {
  400: json("Invalid request, or ids that already exist", ErrorBody),
  401: json("No credential", ErrorBody),
  403: json("The credential cannot do this", ErrorBody),
  404: json("No such task, dataset, version or row", ErrorBody),
  409: json("The dataset already exists, or it moved past the base version", ErrorBody),
};

const routes = {
  list: createRoute({
    method: "get",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets",
    request: { params: SlugParam },
    responses: { 200: json("The task's case datasets with their newest version", z.object({ datasets: z.array(DatasetSummary) })), ...errors },
  }),
  create: createRoute({
    method: "post",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets",
    request: { params: SlugParam, body: body(DatasetCreate) },
    responses: { 201: json("The dataset at version 1", z.object({ dataset: DatasetSnapshot })), ...errors },
  }),
  get: createRoute({
    method: "get",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}",
    request: { params: NameParam, query: z.object({ version: z.coerce.number().int().min(1).optional() }) },
    responses: { 200: json("Every row of one version, the newest when no version is given", z.object({ dataset: DatasetSnapshot })), ...errors },
  }),
  versions: createRoute({
    method: "get",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}/versions",
    request: { params: NameParam },
    responses: { 200: json("Every version, newest first; none is ever rewritten", z.object({ versions: z.array(DatasetVersion) })), ...errors },
  }),
  exportJsonl: createRoute({
    method: "get",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}/export",
    request: { params: NameParam, query: z.object({ version: z.coerce.number().int().min(1).optional() }) },
    responses: {
      200: { description: "One case per line, in the benchmark file format", content: { "application/x-ndjson": { schema: z.string() } } },
      ...errors,
    },
  }),
  append: createRoute({
    method: "post",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}/rows",
    request: { params: NameParam, body: body(RowsAppend) },
    responses: { 201: json("The new version and the rows it added", WriteResponse), ...errors },
  }),
  edit: createRoute({
    method: "patch",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}",
    request: { params: RowParam, body: body(RowPatch) },
    responses: { 200: json("The new version and the row as it now reads", WriteResponse), ...errors },
  }),
  remove: createRoute({
    method: "delete",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}",
    request: { params: RowParam, query: z.object({ baseVersion: z.coerce.number().int().min(1) }) },
    responses: { 200: json("The new version without the row", WriteResponse), ...errors },
  }),
  history: createRoute({
    method: "get",
    security: SECURITY,
    path: "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}/history",
    request: { params: RowParam },
    responses: { 200: json("Every revision of the row, newest first", z.object({ revisions: z.array(RowRevision) })), ...errors },
  }),
};

const FAILURE_STATUS = {
  dataset_not_found: 404,
  row_not_found: 404,
  dataset_exists: 409,
  version_conflict: 409,
  duplicate_ids: 400,
} as const;

function failureBody(failure: WriteFailure) {
  const { ok: _ok, ...rest } = failure;
  return rest;
}

function stripRevision<T extends { position: number }>({ position: _position, ...rest }: T) {
  return rest;
}

export function createDatasetsRouter({ store, datasets }: { store: Store; datasets: CaseDatasetStore }) {
  const router = new OpenAPIHono<{ Variables: CallerVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: "invalid_request", issues: result.error.issues }, 400);
    },
  });

  const author = (caller: CallerVariables["caller"]) => caller.email ?? caller.userId ?? caller.authType;
  const taskMissing = async (slug: string) => (await store.getTask(slug)) === null;
  const notFound = { error: "not_found" };

  function written(result: WriteResult) {
    if (result.ok) return { body: { version: result.version, rows: result.rows }, status: null };
    return { body: failureBody(result), status: FAILURE_STATUS[result.error] };
  }

  router.openapi(routes.list, async (c) => {
    const { slug } = c.req.valid("param");
    if (await taskMissing(slug)) return c.json(notFound, 404);
    return c.json({ datasets: await datasets.listDatasets(slug) }, 200);
  });

  router.openapi(routes.create, async (c) => {
    const { slug } = c.req.valid("param");
    if (await taskMissing(slug)) return c.json(notFound, 404);
    const { name, rows } = c.req.valid("json");
    const result = await datasets.createDataset(slug, name, rows, { author: author(c.get("caller")) });
    if (!result.ok) return c.json(failureBody(result), FAILURE_STATUS[result.error]);
    const snapshot = await datasets.getDataset(slug, name);
    return c.json({ dataset: snapshot! }, 201);
  });

  router.openapi(routes.get, async (c) => {
    const { slug, name } = c.req.valid("param");
    const snapshot = await datasets.getDataset(slug, name, c.req.valid("query").version);
    if (!snapshot) return c.json(notFound, 404);
    return c.json({ dataset: snapshot }, 200);
  });

  router.openapi(routes.versions, async (c) => {
    const { slug, name } = c.req.valid("param");
    const versions = await datasets.listVersions(slug, name);
    if (!versions) return c.json(notFound, 404);
    return c.json({ versions }, 200);
  });

  router.openAPIRegistry.registerPath(routes.exportJsonl);
  router.get("/v1/tasks/:slug/datasets/:name/export", async (c) => {
    const version = c.req.query("version");
    const number = version === undefined ? undefined : Number(version);
    if (number !== undefined && !(Number.isInteger(number) && number >= 1)) return c.json({ error: "invalid_request" }, 400);
    const snapshot = await datasets.getDataset(c.req.param("slug"), c.req.param("name"), number);
    if (!snapshot) return c.json(notFound, 404);
    c.header("content-disposition", `attachment; filename="${snapshot.name}-v${snapshot.version.number}.jsonl"`);
    return c.body(toJsonl(snapshot.rows), 200, { "content-type": "application/x-ndjson; charset=utf-8" });
  });

  router.openapi(routes.append, async (c) => {
    const { slug, name } = c.req.valid("param");
    const { rows, source, baseVersion } = c.req.valid("json");
    const outcome = written(await datasets.addRows(slug, name, rows, source, { author: author(c.get("caller")), baseVersion }));
    return outcome.status === null ? c.json(outcome.body, 201) : c.json(outcome.body, outcome.status);
  });

  router.openapi(routes.edit, async (c) => {
    const { slug, name, rowId } = c.req.valid("param");
    const { baseVersion, ...edit } = c.req.valid("json");
    const outcome = written(await datasets.editRow(slug, name, rowId, edit, { author: author(c.get("caller")), baseVersion }));
    return outcome.status === null ? c.json(outcome.body, 200) : c.json(outcome.body, outcome.status);
  });

  router.openapi(routes.remove, async (c) => {
    const { slug, name, rowId } = c.req.valid("param");
    const { baseVersion } = c.req.valid("query");
    const outcome = written(await datasets.deleteRow(slug, name, rowId, { author: author(c.get("caller")), baseVersion }));
    return outcome.status === null ? c.json(outcome.body, 200) : c.json(outcome.body, outcome.status);
  });

  router.openapi(routes.history, async (c) => {
    const { slug, name, rowId } = c.req.valid("param");
    const revisions = await datasets.rowHistory(slug, name, rowId);
    if (!revisions) return c.json(notFound, 404);
    return c.json({ revisions: revisions.map(stripRevision) }, 200);
  });

  return router;
}
