"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { TrainStatusBadge } from "@/components/badges";
import type { TrainRun } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { trainRunHref } from "@/lib/nav";
import { formatMetric, runMetric } from "@/lib/training";

function metricColumn(name: string, header: string): ColumnDef<TrainRun> {
  return {
    id: name,
    header,
    meta: { align: "right" },
    sortUndefined: "last",
    accessorFn: (run) => runMetric(run, name) ?? undefined,
    cell: ({ row }) => <span className="tabular-nums">{formatMetric(runMetric(row.original, name))}</span>,
  };
}

function columns(slug: string): ColumnDef<TrainRun>[] {
  return [
    {
      accessorKey: "key",
      header: "Run",
      cell: ({ row }) => (
        <Link
          href={trainRunHref(slug, row.original.key)}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-xs font-medium hover:underline"
        >
          {row.original.key}
        </Link>
      ),
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <TrainStatusBadge status={row.original.status} /> },
    { accessorKey: "method", header: "Method" },
    { accessorKey: "base", header: "Base", cell: ({ row }) => <ModelName model={row.original.base} className="max-w-48" /> },
    metricColumn("eval_loss", "Eval loss"),
    metricColumn("eval_reward", "Eval reward"),
    {
      accessorKey: "startedAt",
      header: "Started",
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.startedAt)}</span>,
    },
  ];
}

export function TrainRunsTable({ slug, runs }: { slug: string; runs: TrainRun[] }) {
  return <DataTable columns={columns(slug)} data={runs} getRowId={(run) => run.key} initialSorting={[{ id: "startedAt", desc: true }]} />;
}
