"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { ArrowSquareInIcon, ArrowSquareOutIcon, GaugeIcon, HashIcon, TargetIcon } from "@phosphor-icons/react";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { ScoreMeter } from "@modelstill/ui/blocks/table-cells";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { LineDiff } from "@/components/evals/line-diff";
import type { RunCase } from "@/lib/api";
import { metricLabel } from "@/lib/format";
import { isUnitScore, previewText, scoreColumns } from "@/lib/run-detail";

function scoreLabel(name: string): string {
  return name === "score" ? "case score" : metricLabel(name);
}

function scoreOf(entry: RunCase, name: string): number | undefined {
  return name === "score" ? entry.score : entry.metrics[name];
}

function showNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function Score({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-muted-foreground">missing</span>;
  return <span className="tabular-nums">{showNumber(value)}</span>;
}

function Preview({ value }: { value: unknown }) {
  const text = previewText(value);
  if (!text) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="block max-w-48 truncate font-mono text-xs" title={text}>
      {text}
    </span>
  );
}

function columnsFor(names: string[], unit: Set<string>): ColumnDef<RunCase>[] {
  return [
    { accessorKey: "inputHash", header: "Case", meta: { icon: HashIcon }, cell: ({ row }) => <CodeId value={row.original.inputHash} length={12} /> },
    { id: "input", header: "Input", meta: { icon: ArrowSquareInIcon }, enableSorting: false, cell: ({ row }) => <Preview value={row.original.input} /> },
    { id: "output", header: "Output", meta: { icon: ArrowSquareOutIcon }, enableSorting: false, cell: ({ row }) => <Preview value={row.original.output} /> },
    { id: "expected", header: "Expected", meta: { icon: TargetIcon }, enableSorting: false, cell: ({ row }) => <Preview value={row.original.expected} /> },
    ...names.map(
      (name): ColumnDef<RunCase> => ({
        id: `metric:${name}`,
        accessorFn: (row) => scoreOf(row, name) ?? -Infinity,
        header: scoreLabel(name),
        meta: unit.has(name) ? { label: scoreLabel(name), icon: GaugeIcon } : { align: "right", label: scoreLabel(name), icon: GaugeIcon },
        cell: ({ row }) => {
          const value = scoreOf(row.original, name);
          return unit.has(name) && value !== undefined ? <ScoreMeter value={value} segments={10} format={showNumber} /> : <Score value={value} />;
        },
      }),
    ),
  ];
}

function Block({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="type-label text-muted-foreground">{title}</h3>
      <div data-testid={testId}>{children}</div>
    </div>
  );
}

function Value({ value, missing }: { value: unknown; missing: string }) {
  if (value === null || value === undefined) return <p className="text-muted-foreground">{missing}</p>;
  return <JsonView value={value} maxHeight={240} />;
}

function CaseScores({ entry, names }: { entry: RunCase; names: string[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-muted-foreground">Score</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {names.map((name) => (
            <TableRow key={name} data-testid="run-case-score" data-metric={name}>
              <TableCell className="px-3 py-1">{scoreLabel(name)}</TableCell>
              <TableCell className="px-3 py-1 text-right">
                <Score value={scoreOf(entry, name)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunCaseDetail({ entry, names }: { entry: RunCase; names: string[] }) {
  return (
    <div data-testid="run-case-detail" className="flex flex-col gap-4">
      <CaseScores entry={entry} names={names} />
      <Block title="Input" testId="run-case-input">
        <Value value={entry.input} missing="The run was pushed without inputs." />
      </Block>
      <Block title="Output" testId="run-case-output">
        <Value value={entry.output} missing="The run was pushed without outputs." />
      </Block>
      <Block title="Expected" testId="run-case-expected">
        <Value value={entry.expected} missing="This case has no expected answer." />
      </Block>
      <Block title="Expected vs output, line by line" testId="run-case-line-diff">
        <LineDiff expected={entry.expected} output={entry.output} />
      </Block>
    </div>
  );
}

export function RunCasesTable({ cases, toolbar, footer }: { cases: RunCase[]; toolbar?: ReactNode; footer?: ReactNode }) {
  const names = useMemo(() => scoreColumns(cases), [cases]);
  const columns = useMemo(() => columnsFor(names, new Set(names.filter((name) => isUnitScore(cases, name)))), [names, cases]);
  return (
    <DataTable
      columns={columns}
      data={cases}
      getRowId={(row) => row.inputHash}
      maxHeight="70vh"
      columnToggle
      toolbar={toolbar}
      footer={footer}
      emptyMessage="This run has no cases."
      detail={{
        title: (row) => (
          <span className="flex items-center gap-2">
            Case <CodeId value={row.inputHash} length={16} />
          </span>
        ),
        description: () => "Full input, output and expected answer, with every score for this case.",
        render: (row) => <RunCaseDetail entry={row} names={names} />,
      }}
    />
  );
}
