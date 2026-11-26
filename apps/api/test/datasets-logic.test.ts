import { describe, expect, test } from "bun:test";
import { benchmarkVersion, caseTags, planNewRows, pythonJson, snapshotAt, type RowRevision } from "../src/datasets.ts";

describe("pythonJson", () => {
  test("matches json.dumps with sort_keys and compact separators", () => {
    expect(pythonJson({ b: 1, a: [true, null, 2.5] })).toBe('{"a":[true,null,2.5],"b":1}');
  });

  test("escapes non-ASCII the way ensure_ascii does", () => {
    expect(pythonJson("Österreich ✓ 😀")).toBe('"\\u00d6sterreich \\u2713 \\ud83d\\ude00"');
  });

  test("keeps control escapes and pads exponents to two digits", () => {
    expect(pythonJson("a\nb\t\u0001")).toBe('"a\\nb\\t\\u0001"');
    expect(pythonJson(1e-7)).toBe("1e-07");
    expect(pythonJson(1e21)).toBe("1e+21");
  });
});

describe("benchmarkVersion", () => {
  test("equals the hash python's Benchmark.version computes for the same cases", () => {
    const rows = [
      { id: "c1", input: { q: "Capital of France?", lang: "en" }, expected: "Paris", metadata: { tags: ["geo"] } },
      { id: "c2", input: "Hauptstadt von Österreich?", expected: { city: "Wien", n: 2 }, metadata: {} },
      { id: "c3", input: [1, 2.5, true, null], expected: null, metadata: { tags: ["a", "b"], source: "x" } },
    ];
    expect(benchmarkVersion(rows)).toBe("8f4df903e1874987017fc9b1b17d18231765d2faf0ddcc513da7ec15dd543dcd");
    expect(benchmarkVersion([])).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
  });

  test("reads tags only from a list of strings in metadata", () => {
    expect(caseTags({ tags: ["a", "b"] })).toEqual(["a", "b"]);
    expect(caseTags({ tags: "a" })).toEqual([]);
    expect(caseTags({ tags: ["a", 1] })).toEqual([]);
    expect(caseTags({})).toEqual([]);
  });
});

describe("planNewRows", () => {
  test("keeps given ids, makes new ones, and numbers positions after the last", () => {
    const plan = planNewRows([{ id: "keep", input: "x" }, { input: "y", expected: "z", metadata: { k: 1 } }], new Set(["old"]), 4, () => "gen-1");
    expect(plan).toEqual({
      ok: true,
      rows: [
        { id: "keep", input: "x", expected: null, metadata: {}, position: 5 },
        { id: "gen-1", input: "y", expected: "z", metadata: { k: 1 }, position: 6 },
      ],
    });
  });

  test("refuses ids that already exist or repeat inside the batch", () => {
    const plan = planNewRows([{ id: "a", input: 1 }, { id: "old", input: 2 }, { id: "a", input: 3 }], new Set(["old"]), 0, () => "g");
    expect(plan).toEqual({ ok: false, duplicates: [{ index: 1, id: "old" }, { index: 2, id: "a" }] });
  });
});

describe("snapshotAt", () => {
  const revisions: RowRevision[] = [
    { rowId: "a", version: 1, position: 1, deleted: false, input: "a1", expected: null, metadata: {}, author: null, createdAt: "t1" },
    { rowId: "b", version: 1, position: 2, deleted: false, input: "b1", expected: null, metadata: {}, author: null, createdAt: "t1" },
    { rowId: "a", version: 2, position: 1, deleted: false, input: "a2", expected: null, metadata: {}, author: null, createdAt: "t2" },
    { rowId: "b", version: 3, position: 2, deleted: true, input: "b1", expected: null, metadata: {}, author: null, createdAt: "t3" },
  ];

  test("takes each row's last revision at or before the version and drops deleted rows", () => {
    expect(snapshotAt(revisions, 1).map((row) => [row.id, row.input])).toEqual([["a", "a1"], ["b", "b1"]]);
    expect(snapshotAt(revisions, 2).map((row) => [row.id, row.input, row.version])).toEqual([["a", "a2", 2], ["b", "b1", 1]]);
    expect(snapshotAt(revisions, 3).map((row) => row.id)).toEqual(["a"]);
  });
});
