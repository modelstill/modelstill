import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database, Executor } from "./db/client.ts";
import { caseDatasetVersions, caseDatasets, caseRows, tasks } from "./db/schema.ts";
import {
  benchmarkVersion,
  editedRow,
  planNewRows,
  snapshotAt,
  type CaseDatasetStore,
  type DatasetChange,
  type DatasetVersion,
  type Metadata,
  type PlannedRow,
  type RowRevision,
  type StoredRow,
  type WriteOptions,
  type WriteResult,
} from "./datasets.ts";

type VersionRow = typeof caseDatasetVersions.$inferSelect;
type RevisionRow = typeof caseRows.$inferSelect;

function toVersion(row: VersionRow): DatasetVersion {
  return {
    number: row.number,
    hash: row.hash,
    parent: row.parent,
    rowCount: row.rowCount,
    change: row.change as DatasetChange,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRevision(row: RevisionRow): RowRevision {
  return {
    rowId: row.rowId,
    version: row.version,
    position: row.position,
    deleted: row.deleted,
    input: row.input ?? null,
    expected: row.expected ?? null,
    metadata: (row.metadata as Metadata | null) ?? {},
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

type Located = { id: string; head: VersionRow };

export function createPostgresDatasets(db: Database): CaseDatasetStore {
  async function taskId(tx: Executor, slug: string): Promise<string | null> {
    const [task] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug));
    return task?.id ?? null;
  }

  async function locate(tx: Executor, slug: string, name: string, lock: boolean): Promise<Located | null> {
    const query = tx
      .select({ id: caseDatasets.id })
      .from(caseDatasets)
      .innerJoin(tasks, eq(caseDatasets.taskId, tasks.id))
      .where(and(eq(tasks.slug, slug), eq(caseDatasets.name, name)));
    const [found] = lock ? await query.for("update", { of: caseDatasets }) : await query;
    if (!found) return null;
    const [head] = await tx
      .select()
      .from(caseDatasetVersions)
      .where(eq(caseDatasetVersions.datasetId, found.id))
      .orderBy(desc(caseDatasetVersions.number))
      .limit(1);
    return head ? { id: found.id, head } : null;
  }

  async function revisionsUpTo(tx: Executor, datasetId: string, version: number): Promise<RowRevision[]> {
    const rows = await tx
      .selectDistinctOn([caseRows.rowId])
      .from(caseRows)
      .where(and(eq(caseRows.datasetId, datasetId), sql`${caseRows.version} <= ${version}`))
      .orderBy(asc(caseRows.rowId), desc(caseRows.version));
    return rows.map(toRevision);
  }

  async function snapshot(tx: Executor, datasetId: string, version: number): Promise<StoredRow[]> {
    return snapshotAt(await revisionsUpTo(tx, datasetId, version), version);
  }

  async function lastPosition(tx: Executor, datasetId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${caseRows.position})` })
      .from(caseRows)
      .where(eq(caseRows.datasetId, datasetId));
    return Number(row?.max ?? 0);
  }

  async function commit(
    tx: Executor,
    datasetId: string,
    parent: number | null,
    change: DatasetChange,
    written: (PlannedRow & { deleted: boolean })[],
    author: string | null,
  ): Promise<WriteResult> {
    const number = (parent ?? 0) + 1;
    for (let start = 0; start < written.length; start += 1000) {
      await tx.insert(caseRows).values(
        written.slice(start, start + 1000).map((row) => ({
          datasetId,
          rowId: row.id,
          version: number,
          position: row.position,
          deleted: row.deleted,
          input: row.input ?? null,
          expected: row.expected ?? null,
          metadata: row.metadata,
          author,
        })),
      );
    }
    const rows = await snapshot(tx, datasetId, number);
    const [stored] = await tx
      .insert(caseDatasetVersions)
      .values({ datasetId, number, hash: benchmarkVersion(rows), parent, rowCount: rows.length, change, author })
      .returning();
    const changed = new Set(written.filter((row) => !row.deleted).map((row) => row.id));
    return { ok: true, version: toVersion(stored!), rows: rows.filter((row) => changed.has(row.id)) };
  }

  function stale(located: Located, options: WriteOptions): WriteResult | null {
    if (options.baseVersion !== undefined && options.baseVersion !== located.head.number) {
      return { ok: false, error: "version_conflict", head: located.head.number };
    }
    return null;
  }

  async function onRow(
    slug: string,
    name: string,
    rowId: string,
    options: WriteOptions,
    write: (tx: Executor, located: Located, row: StoredRow) => Promise<WriteResult>,
  ): Promise<WriteResult> {
    return db.transaction(async (tx) => {
      const located = await locate(tx, slug, name, true);
      if (!located) return { ok: false, error: "dataset_not_found" };
      const row = (await snapshot(tx, located.id, located.head.number)).find((entry) => entry.id === rowId);
      if (!row) return { ok: false, error: "row_not_found" };
      return stale(located, options) ?? write(tx, located, row);
    });
  }

  return {
    listDatasets: async (slug) => {
      const rows = await db
        .select({ name: caseDatasets.name, createdAt: caseDatasets.createdAt, version: caseDatasetVersions })
        .from(caseDatasets)
        .innerJoin(tasks, eq(caseDatasets.taskId, tasks.id))
        .innerJoin(caseDatasetVersions, eq(caseDatasetVersions.datasetId, caseDatasets.id))
        .where(
          and(
            eq(tasks.slug, slug),
            sql`${caseDatasetVersions.number} = (select max(v.number) from case_dataset_versions v where v.dataset_id = ${caseDatasets.id})`,
          ),
        )
        .orderBy(asc(caseDatasets.name));
      return rows.map((row) => ({ name: row.name, createdAt: row.createdAt.toISOString(), head: toVersion(row.version) }));
    },

    getDataset: async (slug, name, version) => {
      const located = await locate(db, slug, name, false);
      if (!located) return null;
      let chosen = located.head;
      if (version !== undefined && version !== located.head.number) {
        const [found] = await db
          .select()
          .from(caseDatasetVersions)
          .where(and(eq(caseDatasetVersions.datasetId, located.id), eq(caseDatasetVersions.number, version)));
        if (!found) return null;
        chosen = found;
      }
      return { name, head: located.head.number, version: toVersion(chosen), rows: await snapshot(db, located.id, chosen.number) };
    },

    listVersions: async (slug, name) => {
      const located = await locate(db, slug, name, false);
      if (!located) return null;
      const rows = await db
        .select()
        .from(caseDatasetVersions)
        .where(eq(caseDatasetVersions.datasetId, located.id))
        .orderBy(desc(caseDatasetVersions.number));
      return rows.map(toVersion);
    },

    rowHistory: async (slug, name, rowId) => {
      const located = await locate(db, slug, name, false);
      if (!located) return null;
      const rows = await db
        .select()
        .from(caseRows)
        .where(and(eq(caseRows.datasetId, located.id), eq(caseRows.rowId, rowId)))
        .orderBy(desc(caseRows.version));
      return rows.length > 0 ? rows.map(toRevision) : null;
    },

    createDataset: async (slug, name, cases, options) =>
      db.transaction(async (tx) => {
        const task = await taskId(tx, slug);
        if (!task) return { ok: false, error: "dataset_not_found" };
        const plan = planNewRows(cases, new Set(), 0);
        if (!plan.ok) return { ok: false, error: "duplicate_ids", duplicates: plan.duplicates };
        const [created] = await tx
          .insert(caseDatasets)
          .values({ taskId: task, name })
          .onConflictDoNothing({ target: [caseDatasets.taskId, caseDatasets.name] })
          .returning({ id: caseDatasets.id });
        if (!created) return { ok: false, error: "dataset_exists" };
        const change: DatasetChange = { kind: "create", rowIds: plan.rows.map((row) => row.id) };
        return commit(tx, created.id, null, change, plan.rows.map((row) => ({ ...row, deleted: false })), options.author);
      }),

    addRows: async (slug, name, cases, kind, options) =>
      db.transaction(async (tx) => {
        const located = await locate(tx, slug, name, true);
        if (!located) return { ok: false, error: "dataset_not_found" };
        const refused = stale(located, options);
        if (refused) return refused;
        const current = await snapshot(tx, located.id, located.head.number);
        const plan = planNewRows(cases, new Set(current.map((row) => row.id)), await lastPosition(tx, located.id));
        if (!plan.ok) return { ok: false, error: "duplicate_ids", duplicates: plan.duplicates };
        const change: DatasetChange = { kind, rowIds: plan.rows.map((row) => row.id) };
        return commit(tx, located.id, located.head.number, change, plan.rows.map((row) => ({ ...row, deleted: false })), options.author);
      }),

    editRow: async (slug, name, rowId, edit, options) =>
      onRow(slug, name, rowId, options, (tx, located, row) =>
        commit(
          tx,
          located.id,
          located.head.number,
          { kind: "edit", rowIds: [rowId] },
          [{ ...editedRow(row, edit), position: row.position, deleted: false }],
          options.author,
        ),
      ),

    deleteRow: async (slug, name, rowId, options) =>
      onRow(slug, name, rowId, options, (tx, located, row) =>
        commit(tx, located.id, located.head.number, { kind: "delete", rowIds: [rowId] }, [{ ...row, deleted: true }], options.author),
      ),
  };
}
