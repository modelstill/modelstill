import { expect, test } from "bun:test";
import type { CaseDatasetStore, WriteResult } from "../src/datasets.ts";

function ok(result: WriteResult) {
  if (!result.ok) throw new Error(`write failed: ${JSON.stringify(result)}`);
  return result;
}

export function datasetStoreContract(slugs: () => { slug: string; other: string }, store: () => CaseDatasetStore) {
  const author = { author: "tester" };

  test("create, add, edit and delete each make one new version and never change an old one", async () => {
    const { slug } = slugs();
    const datasets = store();
    const created = ok(await datasets.createDataset(slug, "gold", [{ id: "a", input: "A?", expected: "a" }, { id: "b", input: "B?" }], author));
    expect(created.version).toMatchObject({ number: 1, parent: null, rowCount: 2, change: { kind: "create", rowIds: ["a", "b"] }, author: "tester" });

    const added = ok(await datasets.addRows(slug, "gold", [{ input: "C?", metadata: { tags: ["new"] } }], "import", { ...author, baseVersion: 1 }));
    expect(added.version).toMatchObject({ number: 2, parent: 1, rowCount: 3, change: { kind: "import" } });
    const newId = added.rows[0]!.id;

    const edited = ok(await datasets.editRow(slug, "gold", "a", { expected: "aa" }, { ...author, baseVersion: 2 }));
    expect(edited.rows).toEqual([{ id: "a", input: "A?", expected: "aa", metadata: {}, version: 3, position: 1 }]);

    const removed = ok(await datasets.deleteRow(slug, "gold", "b", { ...author, baseVersion: 3 }));
    expect(removed.version).toMatchObject({ number: 4, rowCount: 2, change: { kind: "delete", rowIds: ["b"] } });

    const head = await datasets.getDataset(slug, "gold");
    expect(head?.head).toBe(4);
    expect(head?.rows.map((row) => [row.id, row.expected])).toEqual([["a", "aa"], [newId, null]]);
    const first = await datasets.getDataset(slug, "gold", 1);
    expect(first?.version.hash).toBe(created.version.hash);
    expect(first?.rows.map((row) => [row.id, row.expected])).toEqual([["a", "a"], ["b", null]]);
    expect((await datasets.listVersions(slug, "gold"))?.map((version) => version.number)).toEqual([4, 3, 2, 1]);
    const history = await datasets.rowHistory(slug, "gold", "b");
    expect(history?.map((revision) => [revision.version, revision.deleted])).toEqual([[4, true], [1, false]]);
  });

  test("refuses stale writes, duplicate ids, a second create and unknown rows", async () => {
    const { slug } = slugs();
    const datasets = store();
    ok(await datasets.createDataset(slug, "silver", [{ id: "x", input: 1 }], author));
    expect(await datasets.createDataset(slug, "silver", [], author)).toEqual({ ok: false, error: "dataset_exists" });
    ok(await datasets.editRow(slug, "silver", "x", { input: 2 }, { ...author, baseVersion: 1 }));
    expect(await datasets.editRow(slug, "silver", "x", { input: 3 }, { ...author, baseVersion: 1 })).toEqual({ ok: false, error: "version_conflict", head: 2 });
    expect(await datasets.addRows(slug, "silver", [{ id: "x", input: 9 }], "add", author)).toEqual({
      ok: false,
      error: "duplicate_ids",
      duplicates: [{ index: 0, id: "x" }],
    });
    expect(await datasets.deleteRow(slug, "silver", "nope", { ...author, baseVersion: 2 })).toEqual({ ok: false, error: "row_not_found" });
    expect(await datasets.addRows(slug, "missing", [{ input: 1 }], "add", author)).toEqual({ ok: false, error: "dataset_not_found" });
    expect(await datasets.getDataset(slug, "silver", 7)).toBeNull();
    expect(await datasets.rowHistory(slug, "silver", "nope")).toBeNull();
  });

  test("datasets of one task are invisible to another", async () => {
    const { slug, other } = slugs();
    const datasets = store();
    ok(await datasets.createDataset(slug, "bronze", [], author));
    expect((await datasets.listDatasets(slug)).map((entry) => entry.name)).toContain("bronze");
    expect((await datasets.listDatasets(other)).map((entry) => entry.name)).not.toContain("bronze");
    expect(await datasets.getDataset(other, "bronze")).toBeNull();
  });
}
