import type { NewCase } from "./cases-api";

export type FileRow = Record<string, unknown>;

export type ParseError = { row: number; message: string };

export type ParsedFile = { columns: string[]; rows: FileRow[]; errors: ParseError[] };

export type CaseField = "id" | "input" | "expected" | "metadata" | "skip";

export const CASE_FIELDS: { value: CaseField; label: string }[] = [
  { value: "input", label: "Input" },
  { value: "expected", label: "Expected" },
  { value: "metadata", label: "Metadata" },
  { value: "id", label: "Case id" },
  { value: "skip", label: "Do not import" },
];

export type Mapping = Record<string, CaseField>;

export type RowError = { row: number; field: CaseField | "file"; message: string };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function csvRecords(text: string): { records: string[][]; unclosedAt: number | null } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let quoteStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      quoteStart = records.length;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) return { records, unclosedAt: quoteStart };
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return { records, unclosedAt: null };
}

export function parseCsv(text: string): ParsedFile {
  const { records, unclosedAt } = csvRecords(text.replace(/^﻿/, ""));
  const [header, ...body] = records;
  const columns = (header ?? []).map((name) => name.trim());
  const rows: FileRow[] = [];
  const errors: ParseError[] = [];
  body.forEach((record, index) => {
    if (record.length === 1 && record[0] === "") return;
    if (record.length !== columns.length) {
      errors.push({ row: index + 1, message: `${plural(record.length, "field")}, the header has ${columns.length}` });
      return;
    }
    rows.push(Object.fromEntries(columns.map((column, position) => [column, record[position]!])));
  });
  if (unclosedAt !== null) errors.push({ row: unclosedAt, message: "a quoted field is never closed" });
  return { columns, rows, errors };
}

export function parseJsonl(text: string): ParsedFile {
  const columns: string[] = [];
  const rows: FileRow[] = [];
  const errors: ParseError[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      errors.push({ row: index + 1, message: "not valid JSON" });
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push({ row: index + 1, message: "not a JSON object" });
      return;
    }
    for (const key of Object.keys(value)) if (!columns.includes(key)) columns.push(key);
    rows.push(value as FileRow);
  });
  return { columns, rows, errors };
}

export type FileKind = "csv" | "jsonl";

export function fileKind(name: string): FileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "jsonl";
  return null;
}

export function parseImportFile(name: string, text: string): ParsedFile {
  const kind = fileKind(name);
  if (kind === "csv") return parseCsv(text);
  if (kind === "jsonl") return parseJsonl(text);
  return { columns: [], rows: [], errors: [{ row: 0, message: "use a .csv or .jsonl file" }] };
}

const GUESSES: [CaseField, RegExp][] = [
  ["id", /^(id|case_?id|uuid|key)$/i],
  ["input", /^(input|inputs|question|prompt|query|text|messages)$/i],
  ["expected", /^(expected|expected_output|answer|output|label|target|reference|ideal)$/i],
];

export function guessMapping(columns: readonly string[]): Mapping {
  const mapping: Mapping = {};
  for (const column of columns) mapping[column] = GUESSES.find(([, pattern]) => pattern.test(column))?.[0] ?? "metadata";
  return mapping;
}

function readCell(value: unknown, parseJson: boolean): unknown {
  if (typeof value !== "string" || !parseJson) return value;
  const trimmed = value.trim();
  if (!/^([[{"]|-?\d|true$|false$|null$)/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function combine(row: FileRow, columns: readonly string[], parseJson: boolean): unknown {
  const present = columns.filter((column) => !blank(row[column]));
  if (columns.length === 1) return present.length === 1 ? readCell(row[columns[0]!], parseJson) : undefined;
  if (present.length === 0) return undefined;
  return Object.fromEntries(present.map((column) => [column, readCell(row[column], parseJson)]));
}

export type BuildOptions = { parseJson: boolean; existingIds?: ReadonlySet<string> };

export function buildCases(rows: readonly FileRow[], mapping: Mapping, options: BuildOptions): { cases: NewCase[]; errors: RowError[] } {
  const columnsFor = (field: CaseField) => Object.keys(mapping).filter((column) => mapping[column] === field);
  const inputColumns = columnsFor("input");
  if (inputColumns.length === 0) return { cases: [], errors: [{ row: 0, field: "input", message: "map at least one column to input" }] };
  const expectedColumns = columnsFor("expected");
  const metadataColumns = columnsFor("metadata");
  const idColumn = columnsFor("id")[0];
  const firstRowOf = new Map<string, number>();
  const cases: NewCase[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, index) => {
    const number = index + 1;
    const input = combine(row, inputColumns, options.parseJson);
    const rawId = idColumn === undefined ? undefined : row[idColumn];
    const id = blank(rawId) ? undefined : String(rawId).trim();
    if (input === undefined) errors.push({ row: number, field: "input", message: "the input is empty" });
    if (id !== undefined && firstRowOf.has(id)) {
      errors.push({ row: number, field: "id", message: `id ${id} is already used on row ${firstRowOf.get(id)}` });
    } else if (id !== undefined && options.existingIds?.has(id)) {
      errors.push({ row: number, field: "id", message: `id ${id} is already in the dataset` });
    }
    if (id !== undefined && !firstRowOf.has(id)) firstRowOf.set(id, number);
    const expected = expectedColumns.length === 0 ? undefined : combine(row, expectedColumns, options.parseJson);
    const metadata = Object.fromEntries(
      metadataColumns.filter((column) => !blank(row[column])).map((column) => [column, readCell(row[column], options.parseJson)]),
    );
    cases.push({ ...(id === undefined ? {} : { id }), input, ...(expected === undefined ? {} : { expected }), metadata });
  });
  return { cases, errors };
}

export function serverRowErrors(body: unknown): RowError[] {
  if (!body || typeof body !== "object") return [];
  const { duplicates, issues } = body as { duplicates?: { index: number; id: string }[]; issues?: { path?: (string | number)[]; message?: string }[] };
  if (Array.isArray(duplicates)) {
    return duplicates.map((entry) => ({ row: entry.index + 1, field: "id" as const, message: `id ${entry.id} is already in the dataset` }));
  }
  if (Array.isArray(issues)) {
    return issues.map((issue) => {
      const [, index, field] = issue.path ?? [];
      return {
        row: typeof index === "number" ? index + 1 : 0,
        field: (typeof field === "string" ? field : "file") as CaseField | "file",
        message: issue.message ?? "invalid",
      };
    });
  }
  return [];
}
