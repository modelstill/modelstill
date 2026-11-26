import {
  benchmarkVersion,
  editedRow,
  planNewRows,
  snapshotAt,
  type CaseDatasetStore,
  type CaseRow,
  type DatasetChange,
  type DatasetVersion,
  type PlannedRow,
  type RowRevision,
  type WriteOptions,
  type WriteResult,
} from "./datasets.ts";

type Stored = { createdAt: string; versions: DatasetVersion[]; revisions: RowRevision[] };

function head(dataset: Stored): DatasetVersion {
  return dataset.versions[dataset.versions.length - 1]!;
}

export function createMemoryDatasets(): CaseDatasetStore {
  const datasets = new Map<string, Stored>();
  const keyOf = (slug: string, name: string) => `${slug}\u0000${name}`;

  function commit(dataset: Stored, change: DatasetChange, written: (PlannedRow & { deleted: boolean })[], author: string | null): WriteResult {
    const parent = dataset.versions.length > 0 ? head(dataset).number : null;
    const number = (parent ?? 0) + 1;
    const createdAt = new Date().toISOString();
    for (const row of written) {
      dataset.revisions.push({
        rowId: row.id,
        version: number,
        position: row.position,
        deleted: row.deleted,
        input: row.input,
        expected: row.expected,
        metadata: row.metadata,
        author,
        createdAt,
      });
    }
    const rows = snapshotAt(dataset.revisions, number);
    const version: DatasetVersion = { number, hash: benchmarkVersion(rows), parent, rowCount: rows.length, change, author, createdAt };
    dataset.versions.push(version);
    const changed = new Set(written.filter((row) => !row.deleted).map((row) => row.id));
    return { ok: true, version, rows: rows.filter((row) => changed.has(row.id)) };
  }

  function stale(dataset: Stored, options: WriteOptions): WriteResult | null {
    const current = head(dataset).number;
    if (options.baseVersion !== undefined && options.baseVersion !== current) return { ok: false, error: "version_conflict", head: current };
    return null;
  }

  function lastPosition(dataset: Stored): number {
    return dataset.revisions.reduce((max, revision) => Math.max(max, revision.position), 0);
  }

  return {
    listDatasets: async (slug) =>
      [...datasets.entries()]
        .filter(([key]) => key.startsWith(`${slug}\u0000`))
        .map(([key, dataset]) => ({ name: key.slice(slug.length + 1), createdAt: dataset.createdAt, head: head(dataset) }))
        .sort((left, right) => left.name.localeCompare(right.name)),

    getDataset: async (slug, name, version) => {
      const dataset = datasets.get(keyOf(slug, name));
      if (!dataset) return null;
      const current = head(dataset);
      const chosen = version === undefined ? current : dataset.versions.find((entry) => entry.number === version);
      if (!chosen) return null;
      return { name, head: current.number, version: chosen, rows: snapshotAt(dataset.revisions, chosen.number) };
    },

    listVersions: async (slug, name) => {
      const dataset = datasets.get(keyOf(slug, name));
      return dataset ? [...dataset.versions].reverse() : null;
    },

    rowHistory: async (slug, name, rowId) => {
      const dataset = datasets.get(keyOf(slug, name));
      if (!dataset) return null;
      const revisions = dataset.revisions.filter((revision) => revision.rowId === rowId).sort((left, right) => right.version - left.version);
      return revisions.length > 0 ? revisions : null;
    },

    createDataset: async (slug, name, rows, options) => {
      if (datasets.has(keyOf(slug, name))) return { ok: false, error: "dataset_exists" };
      const plan = planNewRows(rows, new Set(), 0);
      if (!plan.ok) return { ok: false, error: "duplicate_ids", duplicates: plan.duplicates };
      const dataset: Stored = { createdAt: new Date().toISOString(), versions: [], revisions: [] };
      datasets.set(keyOf(slug, name), dataset);
      return commit(dataset, { kind: "create", rowIds: plan.rows.map((row) => row.id) }, plan.rows.map((row) => ({ ...row, deleted: false })), options.author);
    },

    addRows: async (slug, name, rows, kind, options) => {
      const dataset = datasets.get(keyOf(slug, name));
      if (!dataset) return { ok: false, error: "dataset_not_found" };
      const refused = stale(dataset, options);
      if (refused) return refused;
      const current = snapshotAt(dataset.revisions, head(dataset).number);
      const plan = planNewRows(rows, new Set(current.map((row) => row.id)), lastPosition(dataset));
      if (!plan.ok) return { ok: false, error: "duplicate_ids", duplicates: plan.duplicates };
      return commit(dataset, { kind, rowIds: plan.rows.map((row) => row.id) }, plan.rows.map((row) => ({ ...row, deleted: false })), options.author);
    },

    editRow: async (slug, name, rowId, edit, options) => {
      const dataset = datasets.get(keyOf(slug, name));
      if (!dataset) return { ok: false, error: "dataset_not_found" };
      const row = snapshotAt(dataset.revisions, head(dataset).number).find((entry) => entry.id === rowId);
      if (!row) return { ok: false, error: "row_not_found" };
      const refused = stale(dataset, options);
      if (refused) return refused;
      const next: CaseRow = editedRow(row, edit);
      return commit(dataset, { kind: "edit", rowIds: [rowId] }, [{ ...next, position: row.position, deleted: false }], options.author);
    },

    deleteRow: async (slug, name, rowId, options) => {
      const dataset = datasets.get(keyOf(slug, name));
      if (!dataset) return { ok: false, error: "dataset_not_found" };
      const row = snapshotAt(dataset.revisions, head(dataset).number).find((entry) => entry.id === rowId);
      if (!row) return { ok: false, error: "row_not_found" };
      const refused = stale(dataset, options);
      if (refused) return refused;
      return commit(dataset, { kind: "delete", rowIds: [rowId] }, [{ ...row, deleted: true }], options.author);
    },
  };
}
