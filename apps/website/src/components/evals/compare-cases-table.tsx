"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { XIcon } from "@phosphor-icons/react";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { Badge } from "@modelstill/ui/components/badge";
import { Button } from "@modelstill/ui/components/button";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { ToolbarText } from "@modelstill/ui/blocks/toolbar";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { cn } from "@modelstill/ui/lib/utils";
import { ChangeBadge } from "@/components/badges";
import { CaseDiff } from "@/components/evals/case-diff";
import type { CompareCase, ComparedCase } from "@/lib/api";
import {
  caseChange,
  caseDelta,
  casesForMetric,
  casesIn,
  changeCounts,
  sortByRegression,
  type CaseFilter,
  type MetricFilter,
} from "@/lib/compare";
import { metricLabel } from "@/lib/format";
import { stepIndex } from "@/lib/flow";
import { isTypingTarget } from "@/lib/shortcuts";
import { SendToReviewButton } from "./send-to-review";

function showScore(value: CompareCase["before"]): string {
  if (value === null) return "missing";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  return String(value);
}

function showDelta(delta: number | null): string {
  if (delta === null) return "n/a";
  if (delta === 0) return "0";
  const magnitude = Number.isInteger(delta) ? String(Math.abs(delta)) : Math.abs(delta).toFixed(3);
  return `${delta > 0 ? "+" : "-"}${magnitude}`;
}

function Delta({ delta }: { delta: number | null }) {
  return (
    <span className={cn("tabular-nums", delta !== null && delta > 0 && "text-status-ok", delta !== null && delta < 0 && "font-medium text-status-fail")}>
      {showDelta(delta)}
    </span>
  );
}

const SIDES = [
  { side: "before", dot: "bg-chart-compare" },
  { side: "after", dot: "bg-chart-1" },
] as const;

function RunLines() {
  return (
    <span className="flex flex-col gap-1">
      {SIDES.map(({ side, dot }) => (
        <span key={side} data-testid="stacked-line" data-side={side} className="flex h-5 items-center gap-1.5 text-muted-foreground">
          <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
          {side}
        </span>
      ))}
    </span>
  );
}

function StackedValues({ before, after }: { before: string; after: string }) {
  return (
    <span className="flex flex-col items-end gap-1 tabular-nums">
      <span className="flex h-5 items-center text-muted-foreground">{before}</span>
      <span className="flex h-5 items-center">{after}</span>
    </span>
  );
}

function pairedNames(cases: readonly CompareCase[]): string[] {
  return [...new Set(cases.flatMap((entry) => Object.keys(entry.metrics ?? {})))].sort();
}

function stackedColumns(names: string[]): ColumnDef<CompareCase>[] {
  return [
    {
      accessorKey: "inputHash",
      header: "Input hash",
      cell: ({ row }) => <CodeId value={row.original.inputHash} length={16} />,
    },
    { id: "run", header: "Run", enableSorting: false, cell: () => <RunLines /> },
    {
      id: "score",
      accessorFn: (row) => caseDelta(row) ?? 0,
      header: "Case score",
      meta: { align: "right", label: "Case score" },
      cell: ({ row }) => (
        <span className="inline-flex items-end gap-2">
          <StackedValues before={showScore(row.original.before)} after={showScore(row.original.after)} />
          <Delta delta={caseDelta(row.original)} />
        </span>
      ),
    },
    ...names.map(
      (name): ColumnDef<CompareCase> => ({
        id: `metric:${name}`,
        accessorFn: (row) => {
          const pair = row.metrics?.[name];
          return pair ? pair.after - pair.before : 0;
        },
        header: metricLabel(name),
        meta: { align: "right", label: metricLabel(name) },
        cell: ({ row }) => {
          const pair = row.original.metrics?.[name];
          if (!pair) return <span className="text-muted-foreground">n/a</span>;
          return (
            <span className="inline-flex items-end gap-2">
              <StackedValues before={showScore(pair.before)} after={showScore(pair.after)} />
              <Delta delta={pair.after - pair.before} />
            </span>
          );
        },
      }),
    ),
    {
      id: "change",
      accessorFn: (row) => caseChange(row),
      header: "Result",
      enableSorting: false,
      cell: ({ row }) => <ChangeBadge change={caseChange(row.original)} />,
    },
  ];
}

type RowView = "single" | "stacked";

const VIEWS: { value: RowView; label: string }[] = [
  { value: "single", label: "Side by side" },
  { value: "stacked", label: "Stacked" },
];

const columns: ColumnDef<CompareCase>[] = [
  {
    accessorKey: "inputHash",
    header: "Input hash",
    cell: ({ row }) => <CodeId value={row.original.inputHash} length={16} />,
  },
  {
    id: "before",
    accessorFn: (row) => showScore(row.before),
    header: "Before",
    enableSorting: false,
    meta: { align: "right" },
  },
  {
    id: "after",
    accessorFn: (row) => showScore(row.after),
    header: "After",
    enableSorting: false,
    meta: { align: "right" },
  },
  {
    id: "delta",
    accessorFn: (row) => caseDelta(row) ?? 0,
    header: "Change",
    meta: { align: "right", label: "Change" },
    cell: ({ row }) => <Delta delta={caseDelta(row.original)} />,
  },
  {
    id: "change",
    accessorFn: (row) => caseChange(row),
    header: "Result",
    enableSorting: false,
    cell: ({ row }) => <ChangeBadge change={caseChange(row.original)} />,
  },
];

const FILTERS: { value: CaseFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "broken", label: "Broken" },
  { value: "fixed", label: "Fixed" },
  { value: "unchanged", label: "Unchanged" },
];

const EMPTY: Record<CaseFilter, string> = {
  all: "These runs share no cases.",
  broken: "No case got worse.",
  fixed: "No case got better.",
  unchanged: "Every case changed.",
};

function useRowKeys(rows: CompareCase[], selected: string | null, setSelected: (hash: string) => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || document.querySelector("[role=dialog]")) return;
      if (event.key !== "j" && event.key !== "k") return;
      const current = selected === null ? null : rows.findIndex((row) => row.inputHash === selected);
      const next = stepIndex(current === -1 ? null : current, event.key === "j" ? 1 : -1, rows.length);
      if (next === null) return;
      event.preventDefault();
      setSelected(rows[next]!.inputHash);
      document.querySelector(`[data-input-hash="${CSS.escape(rows[next]!.inputHash)}"]`)?.scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, selected, setSelected]);
}

function MetricFilterChip({ filter, onClear }: { filter: MetricFilter; onClear?: () => void }) {
  const label = `${filter.metric === "score" ? "case score" : metricLabel(filter.metric)} ${filter.direction}`;
  return (
    <Badge variant={filter.direction === "improved" ? "success" : "danger"} className="gap-1 pr-0.5">
      {label}
      {onClear && (
        <Button type="button" variant="ghost" size="icon-xs" className="size-4 rounded-sm" aria-label={`Clear filter ${label}`} onClick={onClear}>
          <XIcon aria-hidden="true" />
        </Button>
      )}
    </Badge>
  );
}

export function CompareCasesTable({
  cases,
  loadCase,
  onSend,
  sending = false,
  metricFilter = null,
  onClearMetricFilter,
}: {
  cases: CompareCase[];
  loadCase: (inputHash: string) => Promise<ComparedCase>;
  onSend?: (inputHashes: string[]) => void;
  sending?: boolean;
  metricFilter?: MetricFilter | null;
  onClearMetricFilter?: () => void;
}) {
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [view, setView] = useState<RowView>("single");
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const scoped = useMemo(() => (metricFilter ? casesForMetric(cases, metricFilter) : cases), [cases, metricFilter]);
  const counts = useMemo(() => changeCounts(scoped), [scoped]);
  const rows = useMemo(() => sortByRegression(casesIn(scoped, filter)), [scoped, filter]);
  const stacked = useMemo(() => stackedColumns(pairedNames(cases)), [cases]);
  const active = selected === null ? undefined : cases.find((entry) => entry.inputHash === selected);
  useRowKeys(rows, selected, setSelected);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2 xl:items-start">
      <DataTable
        columns={view === "stacked" ? stacked : columns}
        data={rows}
        getRowId={(row) => row.inputHash}
        maxHeight="70vh"
        enableRowSelection={Boolean(onSend)}
        selectedIds={onSend ? picked : undefined}
        onSelectionChange={onSend ? setPicked : undefined}
        onRowClick={(row) => setSelected(row.inputHash)}
        emptyMessage={EMPTY[filter]}
        rowClassName={(row) => (row.inputHash === selected ? "bg-muted" : undefined)}
        rowAttributes={(row) => ({ "data-testid": "compare-case-row", "data-input-hash": row.inputHash })}
        toolbar={
          <>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={filter}
              onValueChange={(value: string) => value && setFilter(value as CaseFilter)}
              aria-label="Show cases"
            >
              {FILTERS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} aria-label={`${option.label} ${counts[option.value]}`} className="gap-1.5 px-2.5">
                  {option.label}
                  <span className="text-xs text-muted-foreground tabular-nums">{counts[option.value]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={view}
              onValueChange={(value: string) => value && setView(value as RowView)}
              aria-label="Rows"
            >
              {VIEWS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label} className="px-2.5">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {metricFilter && <MetricFilterChip filter={metricFilter} onClear={onClearMetricFilter} />}
            <ToolbarText className="ml-auto">worst regressions first · J and K move</ToolbarText>
            {onSend && <SendToReviewButton count={picked.length} sending={sending} onClick={() => onSend(picked)} />}
          </>
        }
      />
      <div className="xl:sticky xl:top-4">
        {active ? (
          <div className="flex flex-col gap-2">
            <CaseDiff key={active.inputHash} inputHash={active.inputHash} before={active.before} after={active.after} load={loadCase} />
            {onSend && (
              <div className="flex items-center justify-end gap-2">
                <span className="text-[12px] text-muted-foreground">Neither answer right? A reviewer can write the correct one.</span>
                <SendToReviewButton count={1} sending={sending} onClick={() => onSend([active.inputHash])} label="Send this case to review" />
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
            Pick a case to see its input, the expected answer and both outputs side by side.
          </p>
        )}
      </div>
    </div>
  );
}
