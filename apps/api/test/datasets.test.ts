import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { benchmarkVersion } from "../src/datasets.ts";
import { createMemoryDatasets } from "../src/datasets-memory.ts";
import { createMemoryStore } from "../src/store-memory.ts";

const TOKEN = "test-token";
const SLUG = "capitals";
const BASE = `/v1/tasks/${SLUG}/datasets`;

const cases = [
  { id: "fr", input: { question: "Capital of France?" }, expected: "Paris", metadata: { tags: ["europe"] } },
  { id: "jp", input: { question: "Capital of Japan?" }, expected: "Tokyo" },
];

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const store = createMemoryStore({
    tasks: [{ slug: SLUG, version: 1, snapshotHash: "abc", mode: "off", deferralShare: null, lastGatePassed: null }],
  });
  app = createApp({ store, datasets: createMemoryDatasets(), apiToken: TOKEN });
});

async function call(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed: ReturnType<typeof JSON.parse> = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, contentType: response.headers.get("content-type") };
}

async function created() {
  return call("POST", BASE, { name: "gold", rows: cases });
}

describe("creating a dataset", () => {
  test("makes version 1 with every row and the benchmark hash python would compute", async () => {
    const { status, body } = await created();
    expect(status).toBe(201);
    expect(body.dataset.name).toBe("gold");
    expect(body.dataset.head).toBe(1);
    expect(body.dataset.version).toMatchObject({ number: 1, parent: null, rowCount: 2, change: { kind: "create", rowIds: ["fr", "jp"] } });
    expect(body.dataset.version.hash).toBe(
      benchmarkVersion([
        { id: "fr", input: cases[0]!.input, expected: "Paris", metadata: { tags: ["europe"] } },
        { id: "jp", input: cases[1]!.input, expected: "Tokyo", metadata: {} },
      ]),
    );
    expect(body.dataset.rows.map((row: { id: string; version: number }) => [row.id, row.version])).toEqual([["fr", 1], ["jp", 1]]);
  });

  test("an empty dataset is allowed and a second create with the same name conflicts", async () => {
    expect((await call("POST", BASE, { name: "empty" })).body.dataset.version.rowCount).toBe(0);
    const again = await call("POST", BASE, { name: "empty" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("dataset_exists");
  });

  test("needs a known task, a valid name and a credential", async () => {
    expect((await call("POST", "/v1/tasks/nope/datasets", { name: "gold" })).status).toBe(404);
    expect((await call("POST", BASE, { name: "has space" })).status).toBe(400);
    expect((await call("POST", BASE, { name: "gold" }, null)).status).toBe(401);
  });

  test("reports each invalid row with its index", async () => {
    const { status, body } = await call("POST", BASE, {
      name: "gold",
      rows: [{ input: "ok" }, { expected: "no input" }, { input: "x", metadata: "not an object" }],
    });
    expect(status).toBe(400);
    const paths = body.issues.map((issue: { path: (string | number)[] }) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["rows.1.input", "rows.2.metadata"]));
  });

  test("lists datasets with their head version", async () => {
    await created();
    const { body } = await call("GET", BASE);
    expect(body.datasets).toHaveLength(1);
    expect(body.datasets[0]).toMatchObject({ name: "gold", head: { number: 1, rowCount: 2 } });
  });
});

describe("changing rows", () => {
  test("adding rows makes a new version and leaves the old one readable", async () => {
    await created();
    const { status, body } = await call("POST", `${BASE}/gold/rows`, { baseVersion: 1, rows: [{ input: { question: "Capital of Peru?" }, expected: "Lima" }] });
    expect(status).toBe(201);
    expect(body.version).toMatchObject({ number: 2, parent: 1, rowCount: 3, change: { kind: "add" } });
    expect(body.rows[0].id).toMatch(/^case-/);
    expect((await call("GET", `${BASE}/gold`)).body.dataset.rows).toHaveLength(3);
    const old = await call("GET", `${BASE}/gold?version=1`);
    expect(old.body.dataset.rows).toHaveLength(2);
    expect(old.body.dataset.head).toBe(2);
    expect(old.body.dataset.version.number).toBe(1);
  });

  test("an import is recorded as an import and duplicate ids are refused per row", async () => {
    await created();
    const imported = await call("POST", `${BASE}/gold/rows`, { rows: [{ id: "de", input: "Germany" }], source: "import" });
    expect(imported.body.version.change).toEqual({ kind: "import", rowIds: ["de"] });
    const duplicate = await call("POST", `${BASE}/gold/rows`, { rows: [{ id: "it", input: "Italy" }, { id: "fr", input: "France" }] });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toEqual({ error: "duplicate_ids", duplicates: [{ index: 1, id: "fr" }] });
  });

  test("an edit writes a new version, keeps unchanged fields, and the history shows both", async () => {
    await created();
    const edit = await call("PATCH", `${BASE}/gold/rows/fr`, { baseVersion: 1, expected: "Paris, France" });
    expect(edit.status).toBe(200);
    expect(edit.body.version).toMatchObject({ number: 2, change: { kind: "edit", rowIds: ["fr"] } });
    expect(edit.body.rows[0]).toMatchObject({ id: "fr", input: cases[0]!.input, expected: "Paris, France", metadata: { tags: ["europe"] }, version: 2 });
    const history = await call("GET", `${BASE}/gold/rows/fr/history`);
    expect(history.body.revisions.map((entry: { version: number; expected: unknown; deleted: boolean }) => [entry.version, entry.expected, entry.deleted])).toEqual([
      [2, "Paris, France", false],
      [1, "Paris", false],
    ]);
    expect(history.body.revisions[0].author).toBe("token");
  });

  test("a write against an older version is refused with the current head", async () => {
    await created();
    await call("PATCH", `${BASE}/gold/rows/fr`, { baseVersion: 1, expected: "A" });
    const stale = await call("PATCH", `${BASE}/gold/rows/jp`, { baseVersion: 1, expected: "B" });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: "version_conflict", head: 2 });
  });

  test("an edit needs a base version and at least one field", async () => {
    await created();
    expect((await call("PATCH", `${BASE}/gold/rows/fr`, { expected: "A" })).status).toBe(400);
    expect((await call("PATCH", `${BASE}/gold/rows/fr`, { baseVersion: 1 })).status).toBe(400);
  });

  test("delete removes the row from the new version only", async () => {
    await created();
    const removed = await call("DELETE", `${BASE}/gold/rows/jp?baseVersion=1`);
    expect(removed.status).toBe(200);
    expect(removed.body.version).toMatchObject({ number: 2, rowCount: 1, change: { kind: "delete", rowIds: ["jp"] } });
    expect((await call("GET", `${BASE}/gold`)).body.dataset.rows.map((row: { id: string }) => row.id)).toEqual(["fr"]);
    expect((await call("GET", `${BASE}/gold?version=1`)).body.dataset.rows).toHaveLength(2);
    const history = await call("GET", `${BASE}/gold/rows/jp/history`);
    expect(history.body.revisions[0]).toMatchObject({ version: 2, deleted: true });
    expect((await call("DELETE", `${BASE}/gold/rows/jp?baseVersion=2`)).status).toBe(404);
  });

  test("unknown datasets, rows and versions are 404", async () => {
    await created();
    expect((await call("GET", `${BASE}/missing`)).status).toBe(404);
    expect((await call("GET", `${BASE}/gold?version=9`)).status).toBe(404);
    expect((await call("PATCH", `${BASE}/gold/rows/zz`, { baseVersion: 1, expected: 1 })).status).toBe(404);
    expect((await call("GET", `${BASE}/gold/rows/zz/history`)).status).toBe(404);
    expect((await call("POST", `${BASE}/missing/rows`, { rows: [{ input: 1 }] })).status).toBe(404);
  });
});

describe("versions and export", () => {
  test("lists every version newest first", async () => {
    await created();
    await call("PATCH", `${BASE}/gold/rows/fr`, { baseVersion: 1, metadata: { tags: ["eu"] } });
    await call("DELETE", `${BASE}/gold/rows/jp?baseVersion=2`);
    const { body } = await call("GET", `${BASE}/gold/versions`);
    expect(body.versions.map((version: { number: number; change: { kind: string } }) => [version.number, version.change.kind])).toEqual([
      [3, "delete"],
      [2, "edit"],
      [1, "create"],
    ]);
    expect(new Set(body.versions.map((version: { hash: string }) => version.hash)).size).toBe(3);
  });

  test("exports a version as benchmark JSONL that python's load_benchmark reads", async () => {
    await created();
    const { status, body, contentType } = await call("GET", `${BASE}/gold/export?version=1`);
    expect(status).toBe(200);
    expect(contentType).toContain("application/x-ndjson");
    const lines = String(body).split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toEqual({ id: "fr", input: cases[0]!.input, expected: "Paris", tags: ["europe"], metadata: { tags: ["europe"] } });
    expect(lines).toHaveLength(2);
  });

  test("the OpenAPI document lists the dataset paths", async () => {
    const { body } = await call("GET", "/openapi.json");
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        "/v1/tasks/{slug}/datasets",
        "/v1/tasks/{slug}/datasets/{name}",
        "/v1/tasks/{slug}/datasets/{name}/versions",
        "/v1/tasks/{slug}/datasets/{name}/rows",
        "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}",
        "/v1/tasks/{slug}/datasets/{name}/rows/{rowId}/history",
      ]),
    );
  });
});
