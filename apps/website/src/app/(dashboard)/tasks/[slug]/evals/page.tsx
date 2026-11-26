"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRightIcon, ArrowsLeftRightIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { Button } from "@modelstill/ui/components/button";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { HEADER_BUTTON, HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarNote, ToolbarSpacer } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { RunScore } from "@/components/evals/run-score";
import { ScorerGallery } from "@/components/evals/scorer-gallery";
import { ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { emptyPage } from "@/lib/empty-states";
import type { EvalRun } from "@/lib/api";
import { applySelection, orderPair } from "@/lib/compare";
import { formatDateTime } from "@/lib/format";
import { latestPair } from "@/lib/flow";
import { compareHref, evalRunHref, taskSectionHref } from "@/lib/nav";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function OpenRun({ slug, run }: { slug: string; run: EvalRun }) {
  return (
    <Button asChild variant="ghost" size="xs">
      <Link href={evalRunHref(slug, run.id)} onClick={(event) => event.stopPropagation()} aria-label={`Open the run from ${formatDateTime(run.createdAt)}`}>
        Open
        <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
      </Link>
    </Button>
  );
}

function columnsFor(slug: string): ColumnDef<EvalRun>[] {
  return [...baseColumns, { id: "open", header: "", enableSorting: false, enableHiding: false, meta: { align: "right" }, cell: ({ row }) => <OpenRun slug={slug} run={row.original} /> }];
}

const baseColumns: ColumnDef<EvalRun>[] = [
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
  },
  { accessorKey: "model", header: "Model", cell: ({ row }) => <ModelName model={row.original.model} className="max-w-48" /> },
  { accessorKey: "split", header: "Split" },
  {
    accessorKey: "judgeModel",
    header: "Judge",
    cell: ({ row }) => (row.original.judgeModel ? <ModelName model={row.original.judgeModel} className="max-w-36" /> : <span className="text-muted-foreground">none</span>),
  },
  {
    accessorKey: "mean",
    header: "Score",
    cell: ({ row }) => <RunScore run={row.original} />,
  },
  { accessorKey: "cases", header: "Cases", meta: { align: "right" } },
];

function RunDetail({ slug, run }: { slug: string; run: EvalRun }) {
  return (
    <div className="flex flex-col gap-4">
      <KeyValueList
        items={[
          { label: "Run id", value: <CodeId value={run.id} length={24} /> },
          { label: "Created", value: formatDateTime(run.createdAt) },
          { label: "Model", value: <ModelName model={run.model} /> },
          { label: "Split", value: run.split },
          { label: "Judge", value: run.judgeModel ? <ModelName model={run.judgeModel} /> : "none" },
          { label: "Score", value: <RunScore run={run} digits={3} />, hint: run.primaryMetric ? "primary metric with its interval" : "mean with its interval" },
          { label: "Cases", value: run.cases },
        ]}
      />
      <Button asChild size="sm" className="self-start">
        <Link href={evalRunHref(slug, run.id)}>
          Open the run page
          <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}

export default function EvalRunsPage() {
  const slug = useSlug();
  const runs = useResource((api) => api.listEvalRuns(slug), [slug]);
  const [selected, setSelected] = useState<string[]>([]);
  const columns = useMemo(() => columnsFor(slug), [slug]);
  const pair = runs.status === "ready" ? orderPair(runs.data, selected) : null;

  const latest = runs.status === "ready" ? latestPair(runs.data) : null;

  return (
    <ListPage
      toolbar={
        <>
          {pair ? (
            <Button asChild size="sm" className={HEADER_BUTTON}>
              <Link href={compareHref(slug, pair.before, pair.after)}>
                <ArrowsLeftRightIcon aria-hidden="true" />
                Compare
              </Link>
            </Button>
          ) : (
            <Button size="sm" disabled className={HEADER_BUTTON}>
              <ArrowsLeftRightIcon aria-hidden="true" />
              Compare
            </Button>
          )}
          <ToolbarNote>{selected.length === 0 ? "Tick two runs to compare them case by case" : `${selected.length} of 2 selected`}</ToolbarNote>
          <ToolbarSpacer />
          <ToolbarNote>Scores are means with their 95% intervals</ToolbarNote>
        </>
      }
    >
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "gates")} icon={ShieldCheckIcon}>
          Gates
        </HeaderLink>
        {latest && (
          <HeaderLink href={compareHref(slug, latest.before, latest.after)} icon={ArrowsLeftRightIcon} primary>
            Compare latest two
          </HeaderLink>
        )}
      </PageActions>
      <ResourceView
        resource={runs}
        empty="No eval runs yet for this task."
        emptyState={
          <TaskEmptyState page={emptyPage("evals", slug)}>
            <ScorerGallery />
          </TaskEmptyState>
        }
      >
        {(rows) => (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(run) => run.id}
            enableRowSelection
            selectedIds={selected}
            onSelectionChange={(ids) => setSelected((current) => applySelection(current, ids))}
            initialSorting={[{ id: "createdAt", desc: true }]}
            columnToggle
            detail={{ title: (run) => `Eval run on ${run.split}`, description: (run) => formatDateTime(run.createdAt), render: (run) => <RunDetail slug={slug} run={run} /> }}
            footer={`${rows.length} runs`}
          />
        )}
      </ResourceView>
    </ListPage>
  );
}
