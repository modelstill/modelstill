import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { CallerVariables } from "../auth/caller.ts";
import { decodeCursor, describeRequest, encodeCursor, type RequestLog } from "../requests.ts";

const SECURITY: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKeyHeader: [] }, { sessionCookie: [] }];

const DEFAULT_WINDOW_MS = 7 * 24 * 3600 * 1000;

const ServedRequest = z
  .object({
    id: z.string(),
    ts: z.string(),
    task: z.string(),
    deploymentId: z.string(),
    requestHash: z.string().openapi({ description: "sha256 prefix of the request messages; the messages themselves are not stored" }),
    mode: z.string(),
    servedFrom: z.string(),
    deferred: z.boolean(),
    reason: z.string().nullable(),
    confidence: z.number().nullable(),
    answeredBy: z.string().nullable().openapi({ description: "The model whose answer the caller received" }),
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
  })
  .openapi("ServedRequest");

const Query = z
  .object({
    task: z.string().min(1).optional(),
    deferred: z.enum(["true", "false"]).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine((query, ctx) => {
    if (query.cursor !== undefined && decodeCursor(query.cursor) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a cursor this API returned", path: ["cursor"] });
    }
    if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from must be before to", path: ["from"] });
    }
  });

const listRequests = createRoute({
  method: "get",
  security: SECURITY,
  path: "/v1/requests",
  request: { query: Query },
  responses: {
    200: {
      description: "Gateway requests, newest first, one page at a time",
      content: {
        "application/json": {
          schema: z.object({
            requests: z.array(ServedRequest),
            nextCursor: z.string().nullable(),
            requestBodyStored: z.boolean().openapi({ description: "False while the gateway logs only a hash of each request" }),
          }),
        },
      },
    },
    400: { description: "Invalid filter or cursor", content: { "application/json": { schema: z.object({ error: z.string(), issues: z.array(z.unknown()).optional() }) } } },
  },
});

function window(from: string | undefined, to: string | undefined) {
  const end = to ? Date.parse(to) : from ? Date.parse(from) + DEFAULT_WINDOW_MS : Date.now();
  const start = from ? Date.parse(from) : end - DEFAULT_WINDOW_MS;
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

export function createRequestsRouter({ requests }: { requests: RequestLog }) {
  const router = new OpenAPIHono<{ Variables: CallerVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: "invalid_request", issues: result.error.issues }, 400);
    },
  });

  router.openapi(listRequests, async (c) => {
    const query = c.req.valid("query");
    const rows = await requests.requests({
      task: query.task ?? null,
      deferred: query.deferred === undefined ? null : query.deferred === "true",
      ...window(query.from, query.to),
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null;
    return c.json({ requests: page.map(describeRequest), nextCursor, requestBodyStored: false }, 200);
  });

  return router;
}
