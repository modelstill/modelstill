import { describe, expect, test } from "bun:test";
import { buildCases, guessMapping, parseCsv, parseImportFile, parseJsonl } from "../src/lib/dataset-import";

describe("parseCsv", () => {
  test("reads a header and quoted fields with commas, quotes and newlines", () => {
    const text = '﻿question,answer,notes\r\n"Capital of France, please?",Paris,"said ""hi"""\r\nmulti,"line\nvalue",\r\n';
    expect(parseCsv(text)).toEqual({
      columns: ["question", "answer", "notes"],
      rows: [
        { question: "Capital of France, please?", answer: "Paris", notes: 'said "hi"' },
        { question: "multi", answer: "line\nvalue", notes: "" },
      ],
      errors: [],
    });
  });

  test("reports rows with the wrong number of fields and an unclosed quote", () => {
    const result = parseCsv('a,b\n1,2,3\n4\n"5,6');
    expect(result.errors).toEqual([
      { row: 1, message: "3 fields, the header has 2" },
      { row: 2, message: "1 field, the header has 2" },
      { row: 3, message: "a quoted field is never closed" },
    ]);
  });
});

describe("parseJsonl", () => {
  test("reads one object per line, splitting only on newline", () => {
    const text = '{"q":"a b","a":1}\n\n{"q":"c","tags":["x"]}\n';
    expect(parseJsonl(text)).toEqual({
      columns: ["q", "a", "tags"],
      rows: [{ q: "a b", a: 1 }, { q: "c", tags: ["x"] }],
      errors: [],
    });
  });

  test("reports lines that are not JSON objects", () => {
    expect(parseJsonl('{"a":1}\n[1,2]\nnot json').errors).toEqual([
      { row: 2, message: "not a JSON object" },
      { row: 3, message: "not valid JSON" },
    ]);
  });
});

describe("parseImportFile", () => {
  test("chooses the parser from the file name and refuses other kinds", () => {
    expect(parseImportFile("cases.csv", "a\n1").rows).toEqual([{ a: "1" }]);
    expect(parseImportFile("cases.JSONL", '{"a":1}').rows).toEqual([{ a: 1 }]);
    expect(parseImportFile("cases.ndjson", '{"a":1}').rows).toEqual([{ a: 1 }]);
    expect(parseImportFile("cases.xlsx", "").errors).toEqual([{ row: 0, message: "use a .csv or .jsonl file" }]);
  });
});

describe("guessMapping", () => {
  test("maps common column names to case fields and the rest to metadata", () => {
    expect(guessMapping(["id", "question", "answer", "difficulty"])).toEqual({
      id: "id",
      question: "input",
      answer: "expected",
      difficulty: "metadata",
    });
    expect(guessMapping(["input", "expected", "tags"])).toEqual({ input: "input", expected: "expected", tags: "metadata" });
  });
});

describe("buildCases", () => {
  const rows = [
    { id: "fr", question: "Capital of France?", answer: "Paris", tags: '["europe"]', level: "1" },
    { id: "", question: "Capital of Peru?", answer: "Lima", tags: "", level: "2" },
  ];

  test("builds cases from the mapping, reading JSON inside cells when asked", () => {
    const mapping = { id: "id", question: "input", answer: "expected", tags: "metadata", level: "metadata" } as const;
    expect(buildCases(rows, mapping, { parseJson: true }).cases).toEqual([
      { id: "fr", input: "Capital of France?", expected: "Paris", metadata: { tags: ["europe"], level: 1 } },
      { input: "Capital of Peru?", expected: "Lima", metadata: { level: 2 } },
    ]);
    expect(buildCases(rows, mapping, { parseJson: false }).cases[0]!.metadata).toEqual({ tags: '["europe"]', level: "1" });
  });

  test("several input columns become one object and skipped columns are dropped", () => {
    const built = buildCases(rows, { id: "skip", question: "input", level: "input", answer: "expected", tags: "skip" }, { parseJson: false });
    expect(built.cases[0]).toEqual({ input: { question: "Capital of France?", level: "1" }, expected: "Paris", metadata: {} });
  });

  test("reports a missing input, a repeated id and an id already in the dataset, row by row", () => {
    const built = buildCases(
      [
        { id: "a", q: "x" },
        { id: "b", q: "" },
        { id: "a", q: "y" },
        { id: "taken", q: "z" },
      ],
      { id: "id", q: "input" },
      { parseJson: false, existingIds: new Set(["taken"]) },
    );
    expect(built.errors).toEqual([
      { row: 2, field: "input", message: "the input is empty" },
      { row: 3, field: "id", message: "id a is already used on row 1" },
      { row: 4, field: "id", message: "id taken is already in the dataset" },
    ]);
  });

  test("needs exactly one way to an input", () => {
    expect(buildCases(rows, { question: "metadata" }, { parseJson: false }).errors).toEqual([
      { row: 0, field: "input", message: "map at least one column to input" },
    ]);
  });
});
