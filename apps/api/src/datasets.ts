import { createHash } from "node:crypto";

export type Metadata = Record<string, unknown>;

export type CaseRow = { id: string; input: unknown; expected: unknown; metadata: Metadata };

export type StoredRow = CaseRow & { version: number; position: number };

export type NewCase = { id?: string; input?: unknown; expected?: unknown; metadata?: Metadata };

export type RowEdit = { input?: unknown; expected?: unknown; metadata?: Metadata };

export type ChangeKind = "create" | "import" | "add" | "edit" | "delete";

export type DatasetChange = { kind: ChangeKind; rowIds: string[] };

export type DatasetVersion = {
  number: number;
  hash: string;
  parent: number | null;
  rowCount: number;
  change: DatasetChange;
  author: string | null;
  createdAt: string;
};

export type DatasetSummary = { name: string; createdAt: string; head: DatasetVersion };

export type DatasetSnapshot = { name: string; head: number; version: DatasetVersion; rows: StoredRow[] };

export type RowRevision = {
  rowId: string;
  version: number;
  position: number;
  deleted: boolean;
  input: unknown;
  expected: unknown;
  metadata: Metadata;
  author: string | null;
  createdAt: string;
};

export type WriteOptions = { author: string | null; baseVersion?: number };

export type WriteFailure =
  | { ok: false; error: "dataset_not_found" | "row_not_found" | "dataset_exists" }
  | { ok: false; error: "version_conflict"; head: number }
  | { ok: false; error: "duplicate_ids"; duplicates: { index: number; id: string }[] };

export type WriteSuccess = { ok: true; version: DatasetVersion; rows: StoredRow[] };

export type WriteResult = WriteSuccess | WriteFailure;

export type CaseDatasetStore = {
  listDatasets: (slug: string) => Promise<DatasetSummary[]>;
  getDataset: (slug: string, name: string, version?: number) => Promise<DatasetSnapshot | null>;
  listVersions: (slug: string, name: string) => Promise<DatasetVersion[] | null>;
  rowHistory: (slug: string, name: string, rowId: string) => Promise<RowRevision[] | null>;
  createDataset: (slug: string, name: string, rows: NewCase[], options: WriteOptions) => Promise<WriteResult>;
  addRows: (slug: string, name: string, rows: NewCase[], kind: "import" | "add", options: WriteOptions) => Promise<WriteResult>;
  editRow: (slug: string, name: string, rowId: string, edit: RowEdit, options: WriteOptions) => Promise<WriteResult>;
  deleteRow: (slug: string, name: string, rowId: string, options: WriteOptions) => Promise<WriteResult>;
};

function pythonNumber(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : Number.isNaN(value) ? "NaN" : "-Infinity";
  const text = String(value);
  return text.replace(/e([+-])(\d)$/, "e$10$2");
}

function pythonString(value: string): string {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function pythonJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return pythonNumber(value);
  if (typeof value === "string") return pythonString(value);
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${keys.map((key) => `${pythonString(key)}:${pythonJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return pythonString(String(value));
}

export function caseTags(metadata: Metadata): string[] {
  const tags = metadata["tags"];
  return Array.isArray(tags) && tags.every((tag) => typeof tag === "string") ? (tags as string[]) : [];
}

export function benchmarkVersion(rows: readonly CaseRow[]): string {
  const canonical = pythonJson(rows.map((row) => [row.id, row.input, row.expected, caseTags(row.metadata)]));
  return createHash("sha256").update(canonical).digest("hex");
}

export type PlannedRow = CaseRow & { position: number };

export type RowPlan = { ok: true; rows: PlannedRow[] } | { ok: false; duplicates: { index: number; id: string }[] };

export function newCaseId(): string {
  return `case-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function planNewRows(
  cases: readonly NewCase[],
  existing: ReadonlySet<string>,
  lastPosition: number,
  makeId: () => string = newCaseId,
): RowPlan {
  const seen = new Set(existing);
  const duplicates: { index: number; id: string }[] = [];
  const rows: PlannedRow[] = [];
  cases.forEach((entry, index) => {
    let id = entry.id ?? makeId();
    while (entry.id === undefined && seen.has(id)) id = makeId();
    if (seen.has(id)) {
      duplicates.push({ index, id });
      return;
    }
    seen.add(id);
    rows.push({ id, input: entry.input, expected: entry.expected ?? null, metadata: entry.metadata ?? {}, position: lastPosition + rows.length + 1 });
  });
  return duplicates.length > 0 ? { ok: false, duplicates } : { ok: true, rows };
}

export function snapshotAt(revisions: readonly RowRevision[], version: number): StoredRow[] {
  const latest = new Map<string, RowRevision>();
  for (const revision of revisions) {
    if (revision.version > version) continue;
    const current = latest.get(revision.rowId);
    if (!current || current.version < revision.version) latest.set(revision.rowId, revision);
  }
  return [...latest.values()]
    .filter((revision) => !revision.deleted)
    .sort((left, right) => left.position - right.position || left.rowId.localeCompare(right.rowId))
    .map((revision) => ({
      id: revision.rowId,
      input: revision.input,
      expected: revision.expected,
      metadata: revision.metadata,
      version: revision.version,
      position: revision.position,
    }));
}

export function editedRow(row: StoredRow, edit: RowEdit): CaseRow {
  return {
    id: row.id,
    input: edit.input === undefined ? row.input : edit.input,
    expected: edit.expected === undefined ? row.expected : edit.expected,
    metadata: edit.metadata === undefined ? row.metadata : edit.metadata,
  };
}

export function toJsonl(rows: readonly CaseRow[]): string {
  return rows
    .map((row) => JSON.stringify({ id: row.id, input: row.input, expected: row.expected, tags: caseTags(row.metadata), metadata: row.metadata }))
    .join("\n");
}
