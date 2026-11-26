import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/lib/api";
import { ApiBodyError, createCasesApi } from "../src/lib/cases-api";

type Call = { url: string; method: string; body: unknown };

function stub(respond: (url: URL, method: string) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ url: url.pathname + url.search, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const { status = 200, body } = respond(url, method);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, api: createCasesApi({ baseUrl: "http://api.test", fetchImpl }) };
}

const version = {
  number: 2,
  hash: "8f4df903e1874987017fc9b1b17d18231765d2faf0ddcc513da7ec15dd543dcd",
  parent: 1,
  rowCount: 1,
  change: { kind: "edit", rowIds: ["fr"] },
  author: "token",
  createdAt: "2026-11-24T10:00:00.000Z",
};
const row = { id: "fr", input: "France?", expected: "Paris", metadata: {}, version: 2, position: 1 };

describe("cases api", () => {
  test("reads datasets, one version and a row's history", async () => {
    const { api, calls } = stub((url) => {
      if (url.pathname.endsWith("/history")) return { body: { revisions: [{ rowId: "fr", version: 2, deleted: false, input: "France?", expected: "Paris", metadata: {}, author: null, createdAt: version.createdAt }] } };
      if (url.pathname.endsWith("/datasets")) return { body: { datasets: [{ name: "gold", createdAt: version.createdAt, head: version }] } };
      return { body: { dataset: { name: "gold", head: 2, version, rows: [row] } } };
    });
    expect((await api.listDatasets("capitals"))[0]!.head.number).toBe(2);
    expect((await api.getDataset("capitals", "gold", 1)).rows[0]!.id).toBe("fr");
    expect((await api.rowHistory("capitals", "gold", "fr"))[0]!.version).toBe(2);
    expect(calls.map((call) => call.url)).toEqual([
      "/v1/tasks/capitals/datasets",
      "/v1/tasks/capitals/datasets/gold?version=1",
      "/v1/tasks/capitals/datasets/gold/rows/fr/history",
    ]);
  });

  test("writes send the base version and return the new version", async () => {
    const { api, calls } = stub(() => ({ status: 200, body: { version, rows: [row] } }));
    expect((await api.editRow("capitals", "gold", "fr", 1, { expected: "Paris" })).version.number).toBe(2);
    await api.deleteRow("capitals", "gold", "fr", 2);
    await api.addRows("capitals", "gold", [{ input: "x" }], { source: "import", baseVersion: 2 });
    expect(calls).toEqual([
      { url: "/v1/tasks/capitals/datasets/gold/rows/fr", method: "PATCH", body: { baseVersion: 1, expected: "Paris" } },
      { url: "/v1/tasks/capitals/datasets/gold/rows/fr?baseVersion=2", method: "DELETE", body: undefined },
      { url: "/v1/tasks/capitals/datasets/gold/rows", method: "POST", body: { rows: [{ input: "x" }], source: "import", baseVersion: 2 } },
    ]);
  });

  test("a refused write keeps the error body so the page can show the conflict or the bad rows", async () => {
    const { api } = stub(() => ({ status: 409, body: { error: "version_conflict", head: 5 } }));
    const error = await api.editRow("capitals", "gold", "fr", 1, { expected: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiBodyError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiBodyError).status).toBe(409);
    expect((error as ApiBodyError).body).toEqual({ error: "version_conflict", head: 5 });
  });

  test("lists requests with a query string and parses the page", async () => {
    const { api, calls } = stub(() => ({ body: { requests: [], nextCursor: "next", requestBodyStored: false } }));
    expect(await api.listRequests("task=capitals&limit=50")).toEqual({ requests: [], nextCursor: "next", requestBodyStored: false });
    expect(calls[0]!.url).toBe("/v1/requests?task=capitals&limit=50");
  });

  test("the export link points at the JSONL of one version", () => {
    const { api } = stub(() => ({ body: {} }));
    expect(api.exportUrl("capitals", "gold", 3)).toBe("http://api.test/v1/tasks/capitals/datasets/gold/export?version=3");
  });
});
