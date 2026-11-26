"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DatabaseIcon,
  DownloadSimpleIcon,
  FilePlusIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { Alert, AlertDescription, AlertTitle } from "@modelstill/ui/components/alert";
import { Badge } from "@modelstill/ui/components/badge";
import { Button } from "@modelstill/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@modelstill/ui/components/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@modelstill/ui/components/select";
import { Spinner } from "@modelstill/ui/components/spinner";
import { ListPage, ToolbarSpacer } from "@/components/dashboard/layout";
import { HEADER_BUTTON } from "@/components/dashboard/header-link";
import { ErrorState, LoadingState } from "@/components/states";
import type { CaseRow, CasesApi, DatasetSnapshot, DatasetVersion, NewCase, RowEdit } from "@/lib/cases-api";
import { createAutosave, type Autosave, type AutosaveState } from "@/lib/dataset-edit";
import { formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/use-api";
import { useCasesApi } from "@/lib/use-cases-api";
import { AddRowDialog, ImportDialog, NewDatasetDialog } from "./dataset-dialogs";
import { RowEditor } from "./row-editor";

const AUTOSAVE_DELAY_MS = 700;

function preview(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function tagsOf(row: CaseRow): string[] {
  const tags = row.metadata["tags"];
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

const columns: ColumnDef<CaseRow>[] = [
  { accessorKey: "position", header: "#", meta: { align: "right", className: "w-12 tabular-nums text-muted-foreground" } },
  { accessorKey: "id", header: "Case id", cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.id}</span> },
  {
    id: "input",
    header: "Input",
    enableSorting: false,
    cell: ({ row }) => <span className="block max-w-[360px] truncate font-mono text-[12px] text-muted-foreground">{preview(row.original.input)}</span>,
  },
  {
    id: "expected",
    header: "Expected",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.expected === null ? (
        <span className="text-[12px] text-muted-foreground">none</span>
      ) : (
        <span className="block max-w-[280px] truncate font-mono text-[12px]">{preview(row.original.expected)}</span>
      ),
  },
  {
    id: "tags",
    header: "Tags",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        {tagsOf(row.original).map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </span>
    ),
  },
  {
    accessorKey: "version",
    header: "Last changed",
    meta: { align: "right" },
    cell: ({ row }) => <span className="font-mono text-[12px] text-muted-foreground">v{row.original.version}</span>,
  },
];

function versionLabel(version: DatasetVersion): string {
  const rows = version.change.rowIds.length;
  const what = rows === 1 ? version.change.rowIds[0] : `${rows} rows`;
  return `v${version.number} · ${version.change.kind} ${what} · ${formatDateTime(version.createdAt)}`;
}

function SaveStatus({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
  if (state.status === "pending") return <span className="text-[12px] text-muted-foreground">Unsaved changes</span>;
  if (state.status === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Spinner />
        Saving
      </span>
    );
  if (state.status === "saved")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="save-status">
        <CheckCircleIcon aria-hidden="true" weight="fill" className="text-status-ok" />
        Saved as v{state.version}
      </span>
    );
  if (state.status === "error")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-destructive">
        <WarningCircleIcon aria-hidden="true" />
        Not saved: {state.message}
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  return null;
}

function VersionPicker({ versions, current, head, onPick }: { versions: DatasetVersion[]; current: number; head: number; onPick: (number: number | null) => void }) {
  return (
    <Select value={String(current)} onValueChange={(value) => onPick(Number(value) === head ? null : Number(value))}>
      <SelectTrigger size="sm" className="w-auto max-w-[320px]" aria-label="Dataset version">
        <SelectValue>{current === head ? `v${current} (latest)` : `v${current}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {versions.map((version) => (
            <SelectItem key={version.number} value={String(version.number)}>
              {versionLabel(version)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

type EditorProps = { slug: string; name: string; onHeadChange: () => void };

function DatasetEditor({ slug, name, onHeadChange }: EditorProps) {
  const cases = useCasesApi();
  const [viewing, setViewing] = useState<number | null>(null);
  const snapshot = useResource(() => cases.getDataset(slug, name, viewing ?? undefined), [slug, name, viewing, "case-dataset"]);
  const versions = useResource(() => cases.listVersions(slug, name), [slug, name, "case-dataset-versions"]);
  const [save, setSave] = useState<AutosaveState>({ status: "idle" });
  const [historyKey, setHistoryKey] = useState(0);
  const autosave = useRef<Autosave<RowEdit> | null>(null);
  const refreshSnapshot = snapshot.refresh;
  const refreshVersions = versions.refresh;

  const afterWrite = useCallback(() => {
    refreshSnapshot();
    refreshVersions();
    setHistoryKey((key) => key + 1);
    onHeadChange();
  }, [refreshSnapshot, refreshVersions, onHeadChange]);

  const head = snapshot.status === "ready" ? snapshot.data.head : null;
  useEffect(() => {
    if (head === null || autosave.current) return;
    autosave.current = createAutosave<RowEdit>({
      delayMs: AUTOSAVE_DELAY_MS,
      base: head,
      write: async (rowId, patch, base) => {
        const result = await cases.editRow(slug, name, rowId, base, patch);
        afterWrite();
        return result.version.number;
      },
      onState: setSave,
    });
  }, [head, cases, slug, name, afterWrite]);

  useEffect(() => () => void autosave.current?.flush(), []);

  const write = useCallback(
    async (run: (base: number) => Promise<DatasetVersion>) => {
      const saver = autosave.current;
      if (!saver) throw new Error("the dataset is still loading");
      await saver.flush();
      const version = await run(saver.base);
      saver.reset(version.number);
      setSave({ status: "saved", version: version.number });
      afterWrite();
      return version;
    },
    [afterWrite],
  );

  if (snapshot.status === "loading") return <LoadingState variant="table" />;
  if (snapshot.status === "error") return <ErrorState error={snapshot.error} onRetry={snapshot.reload} />;
  const data: DatasetSnapshot = snapshot.data;
  const readOnly = data.version.number !== data.head;
  const existingIds = new Set(data.rows.map((row) => row.id));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" data-slot="dataset-bar">
        {versions.status === "ready" && <VersionPicker versions={versions.data} current={data.version.number} head={data.head} onPick={setViewing} />}
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="version-id">
          version id <CodeId value={data.version.hash} length={12} />
        </span>
        <span className="text-[12px] text-muted-foreground tabular-nums">{data.version.rowCount} cases</span>
        <SaveStatus state={save} onRetry={() => void autosave.current?.flush()} />
        <ToolbarSpacer />
        <AddRowDialog
          disabled={readOnly}
          onAdd={async (entry: NewCase) => {
            const version = await write(async (base) => (await cases.addRows(slug, name, [entry], { source: "add", baseVersion: base })).version);
            toast.success("Case added", { description: `The dataset is now at v${version.number}.` });
          }}
        />
        <ImportDialog
          existingIds={existingIds}
          taken={[]}
          needsName={false}
          disabled={readOnly}
          onImport={async (rows) => {
            const version = await write(async (base) => (await cases.addRows(slug, name, rows, { source: "import", baseVersion: base })).version);
            return { count: rows.length, version: version.number };
          }}
        />
        <Button asChild size="sm" variant="outline" className={HEADER_BUTTON}>
          <a href={cases.exportUrl(slug, name, data.version.number)} download>
            <DownloadSimpleIcon aria-hidden="true" data-icon="inline-start" />
            Export JSONL
          </a>
        </Button>
      </div>
      {readOnly && (
        <Alert>
          <DatabaseIcon aria-hidden="true" />
          <AlertTitle>Viewing v{data.version.number}, read-only</AlertTitle>
          <AlertDescription>
            <span>
              Versions are never changed after they are written. Edits go into a new version on top of v{data.head}.
            </span>
            <Button size="xs" variant="outline" onClick={() => setViewing(null)}>
              Back to v{data.head}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {save.status === "conflict" && (
        <Alert variant="destructive">
          <WarningCircleIcon aria-hidden="true" />
          <AlertTitle>This dataset moved to v{save.head} while you edited</AlertTitle>
          <AlertDescription>
            <span>Your last change was not written. Load the newest version and make it again.</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                autosave.current?.reset(save.head);
                setViewing(null);
                afterWrite();
              }}
            >
              <ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
              Load v{save.head}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <DataTable
        columns={columns}
        data={data.rows}
        getRowId={(row) => row.id}
        emptyMessage="No cases in this version. Add a row or import a file."
        columnToggle
        footer={`${data.rows.length} cases in v${data.version.number}`}
        detail={{
          title: (row) => `Case ${row.id}`,
          description: () => (readOnly ? `As it was in v${data.version.number}` : "Changes save on their own as a new version"),
          render: (row) => (
            <RowEditor
              key={`${row.id}:${readOnly ? data.version.number : "head"}`}
              row={row}
              readOnly={readOnly}
              historyKey={historyKey}
              loadHistory={() => cases.rowHistory(slug, name, row.id)}
              onChange={(rowId, patch) => autosave.current?.schedule(rowId, patch)}
              onDelete={async (rowId) => {
                const version = await write(async (base) => (await cases.deleteRow(slug, name, rowId, base)).version);
                toast.success(`Case ${rowId} deleted`, { description: `The dataset is now at v${version.number}.` });
              }}
            />
          ),
        }}
      />
    </div>
  );
}

function NoDatasets({ onCreate, onImport }: { onCreate: (name: string) => Promise<void>; onImport: (rows: NewCase[], name: string | null) => Promise<{ count: number; version: number }> }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No case datasets yet</EmptyTitle>
        <EmptyDescription>
          A case dataset holds the inputs and expected answers your evals run on. Every change makes a new version, so a past run can always be re-read against exactly what it saw.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <NewDatasetDialog
          taken={[]}
          onCreate={onCreate}
          trigger={
            <Button size="sm" variant="outline">
              <FilePlusIcon aria-hidden="true" data-icon="inline-start" />
              New dataset
            </Button>
          }
        />
        <ImportDialog
          existingIds={new Set()}
          taken={[]}
          needsName
          onImport={onImport}
          trigger={
            <Button size="sm">
              <UploadSimpleIcon aria-hidden="true" data-icon="inline-start" />
              Import a file
            </Button>
          }
        />
      </EmptyContent>
    </Empty>
  );
}

async function createWith(cases: CasesApi, slug: string, name: string, rows: NewCase[]) {
  const created = await cases.createDataset(slug, name, rows);
  return { count: rows.length, version: created.version.number };
}

export function CaseDatasetsView({ slug, switcher }: { slug: string; switcher: ReactNode }) {
  const cases = useCasesApi();
  const list = useResource(() => cases.listDatasets(slug), [slug, "case-datasets"]);
  const [selected, setSelected] = useState<string | null>(null);
  const names = useMemo(() => (list.status === "ready" ? list.data.map((entry) => entry.name) : []), [list]);
  const name = selected !== null && names.includes(selected) ? selected : (names[0] ?? null);
  const refreshList = list.refresh;
  const reloadList = list.reload;

  const create = async (newName: string) => {
    await cases.createDataset(slug, newName, []);
    setSelected(newName);
    reloadList();
  };
  const importNew = async (rows: NewCase[], newName: string | null) => {
    const result = await createWith(cases, slug, newName ?? "imported", rows);
    setSelected(newName);
    reloadList();
    return result;
  };

  return (
    <ListPage
      toolbar={
        <>
          {switcher}
          {names.length > 0 && name && (
            <Select value={name} onValueChange={setSelected}>
              <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Case dataset">
                <SelectValue>{name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {names.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <ToolbarSpacer />
          {names.length > 0 && <NewDatasetDialog taken={names} onCreate={create} />}
        </>
      }
    >
      {list.status === "loading" && <LoadingState variant="table" />}
      {list.status === "error" && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.status === "ready" && name === null && <NoDatasets onCreate={create} onImport={importNew} />}
      {list.status === "ready" && name !== null && <DatasetEditor key={name} slug={slug} name={name} onHeadChange={refreshList} />}
    </ListPage>
  );
}
