"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowSquareInIcon, BarbellIcon, CircleHalfIcon, GaugeIcon, HashIcon, ListChecksIcon, SealCheckIcon } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { ScoreMeter } from "@modelstill/ui/blocks/table-cells";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { Section } from "@modelstill/ui/blocks/section";
import { Button } from "@modelstill/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@modelstill/ui/components/dialog";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { ReviewStateBadge } from "@/components/badges";
import { CaseDatasetsView } from "@/components/datasets/case-datasets-view";
import { HEADER_BUTTON, HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarNote, ToolbarSpacer } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { ResourceView } from "@/components/states";
import { EmptyCommand, TaskEmptyState } from "@/components/task-empty";
import type { DatasetItem } from "@/lib/api";
import { emptyPage } from "@/lib/empty-states";
import { datasetCounts, labelledCount, type DatasetCounts } from "@/lib/flow";
import { taskSectionHref } from "@/lib/nav";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

type View = keyof DatasetCounts;

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "accepted", label: "Accepted" },
  { value: "corrected", label: "Corrected" },
  { value: "queued", label: "In review" },
  { value: "none", label: "Not reviewed" },
];

function preview(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function settledOutput(item: DatasetItem): unknown {
  if (item.finalOutput !== null && item.finalOutput !== undefined) return item.finalOutput;
  return item.teacherOutputs.length === 1 ? item.teacherOutputs[0]!.output : null;
}

const columns: ColumnDef<DatasetItem>[] = [
  { accessorKey: "inputHash", header: "Input hash", meta: { icon: HashIcon }, cell: ({ row }) => <CodeId value={row.original.inputHash} length={12} /> },
  {
    id: "input",
    header: "Input",
    meta: { icon: ArrowSquareInIcon },
    enableSorting: false,
    cell: ({ row }) => <span className="block max-w-[360px] truncate font-mono text-[12px] text-muted-foreground">{preview(row.original.input)}</span>,
  },
  {
    id: "output",
    header: "Settled answer",
    meta: { icon: SealCheckIcon },
    enableSorting: false,
    cell: ({ row }) => {
      const output = settledOutput(row.original);
      return output === null ? (
        <span className="text-[12px] text-muted-foreground">{row.original.reviewState === "accepted" ? "kept a teacher answer" : "not settled"}</span>
      ) : (
        <span className="block max-w-[280px] truncate font-mono text-[12px]">{preview(output)}</span>
      );
    },
  },
  { accessorKey: "reviewState", header: "State", meta: { icon: CircleHalfIcon }, cell: ({ row }) => <ReviewStateBadge state={row.original.reviewState} /> },
  {
    accessorKey: "agreement",
    header: "Agreement",
    meta: { icon: GaugeIcon },
    sortUndefined: "last",
    cell: ({ row }) => <ScoreMeter value={row.original.agreement} segments={10} />,
  },
];

function ItemDetail({ item }: { item: DatasetItem }) {
  return (
    <>
      <KeyValueList
        items={[
          { label: "Input hash", value: <CodeId value={item.inputHash} length={24} /> },
          { label: "State", value: <ReviewStateBadge state={item.reviewState} /> },
          { label: "Agreement", value: item.agreement === null ? "n/a" : item.agreement.toFixed(2) },
        ]}
      />
      <Section title="Input">
        <JsonView value={item.input} />
      </Section>
      <Section title="Settled answer" description={item.reviewState === "corrected" ? "written by a reviewer" : undefined}>
        <JsonView value={settledOutput(item)} />
      </Section>
      <Section title="Answers seen">
        <div className="flex flex-col gap-2">
          {item.teacherOutputs.map((entry) => (
            <div key={entry.teacher} className="rounded-md border border-border p-2">
              <div className="mb-1 font-mono text-[12px] text-muted-foreground">{entry.teacher}</div>
              <JsonView value={entry.output} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function TrainDialog({ slug, labelled }: { slug: string; labelled: number }) {
  const command = `modelstill train run tasks/${slug}/spec.yaml --train train.jsonl --val val.jsonl --seed 1 --backend remote --host <gpu-host> --gpus 0`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className={HEADER_BUTTON} disabled={labelled === 0}>
          <BarbellIcon aria-hidden="true" />
          Train on {labelled} labelled
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Train a student on this dataset</DialogTitle>
          <DialogDescription>
            Training runs on your GPU host, not in the browser. Accepted and corrected items are the labelled rows. The run shows up under Training as soon as it starts.
          </DialogDescription>
        </DialogHeader>
        <EmptyCommand command={command} />
        <DialogFooter>
          <Button asChild variant="outline" size="sm">
            <Link href={taskSectionHref(slug, "training")}>Open training runs</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatasetTable({ items, view }: { items: DatasetItem[]; view: View }) {
  const rows = useMemo(() => (view === "all" ? items : items.filter((item) => item.reviewState === view)), [items, view]);
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(item) => item.id}
      emptyMessage="No item in this view."
      columnToggle
      detail={{ title: () => "Dataset item", description: (item) => item.inputHash, render: (item) => <ItemDetail item={item} /> }}
      footer={`${rows.length} of ${items.length} items`}
    />
  );
}

type Source = "cases" | "labelled";

function SourceSwitch({ value, onChange }: { value: Source; onChange: (value: Source) => void }) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(next) => next && onChange(next as Source)} aria-label="Dataset kind">
      <ToggleGroupItem value="cases" className="h-7 px-2.5 text-[12px]">
        Cases
      </ToggleGroupItem>
      <ToggleGroupItem value="labelled" className="h-7 px-2.5 text-[12px]">
        Labelled from review
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function LabelledItems({ slug, switcher }: { slug: string; switcher: ReactNode }) {
  const items = useResource((api) => api.listDatasetItems(slug), [slug]);
  const [view, setView] = useState<View>("all");
  const counts = items.status === "ready" ? datasetCounts(items.data) : null;
  const labelled = items.status === "ready" ? labelledCount(items.data) : 0;

  return (
    <ListPage
      toolbar={
        <>
          {switcher}
          <TrainDialog slug={slug} labelled={labelled} />
          <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(value) => value && setView(value as View)} aria-label="Filter by state">
            {VIEWS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} className="h-7 gap-1.5 px-2.5 text-[12px]">
                {option.label}
                {counts && <span className="text-muted-foreground tabular-nums">{counts[option.value]}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToolbarSpacer />
          <ToolbarNote>Accepted and corrected items are what training reads</ToolbarNote>
        </>
      }
    >
      <ResourceView resource={items} empty="No dataset items yet." emptyState={<TaskEmptyState page={emptyPage("datasets", slug)} />}>
        {(data) => <DatasetTable items={data} view={view} />}
      </ResourceView>
    </ListPage>
  );
}

export default function DatasetsPage() {
  const slug = useSlug();
  const [source, setSource] = useState<Source>("cases");
  const switcher = <SourceSwitch value={source} onChange={setSource} />;

  return (
    <>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "review")} icon={ListChecksIcon}>
          Review queue
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "training")} icon={BarbellIcon}>
          Training runs
        </HeaderLink>
      </PageActions>
      {source === "cases" ? <CaseDatasetsView slug={slug} switcher={switcher} /> : <LabelledItems slug={slug} switcher={switcher} />}
    </>
  );
}
