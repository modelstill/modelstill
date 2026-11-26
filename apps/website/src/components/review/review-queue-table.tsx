"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowsLeftRightIcon, CheckIcon, CircleHalfIcon, GaugeIcon, HashIcon, UsersThreeIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { ChipList, ScoreMeter, TablePager } from "@modelstill/ui/blocks/table-cells";
import { diffTeacherOutputs } from "@modelstill/ui/blocks/teacher-diff";
import { Alert, AlertDescription } from "@modelstill/ui/components/alert";
import { Button } from "@modelstill/ui/components/button";
import { Spinner } from "@modelstill/ui/components/spinner";
import { ReviewStateBadge } from "@/components/badges";
import type { ApiClient, ReviewItem } from "@/lib/api";
import { isWaiting } from "@/lib/review";

export const REVIEW_PAGE_SIZE = 25;

export function differing(item: ReviewItem): number {
  return diffTeacherOutputs(item.teacherOutputs).filter((entry) => entry.differs).length;
}

const columns: ColumnDef<ReviewItem>[] = [
  { accessorKey: "inputHash", header: "Input hash", meta: { icon: HashIcon }, cell: ({ row }) => <CodeId value={row.original.inputHash} length={16} /> },
  { accessorKey: "reviewState", header: "State", meta: { icon: CircleHalfIcon }, cell: ({ row }) => <ReviewStateBadge state={row.original.reviewState} /> },
  {
    accessorKey: "agreement",
    header: "Agreement",
    meta: { icon: GaugeIcon },
    sortUndefined: "last",
    cell: ({ row }) => <ScoreMeter value={row.original.agreement} segments={10} />,
  },
  {
    id: "teachers",
    accessorFn: (item) => item.teacherOutputs.length,
    header: "Answers",
    meta: { icon: UsersThreeIcon },
    cell: ({ row }) => <ChipList items={row.original.teacherOutputs.map((entry) => entry.teacher)} max={2} />,
  },
  { id: "differing", accessorFn: differing, header: "Fields that differ", meta: { align: "right", icon: ArrowsLeftRightIcon } },
];

function pageOf(index: number): number {
  return Math.floor(index / REVIEW_PAGE_SIZE) + 1;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function BulkBar({
  selected,
  acceptable,
  reviewer,
  pending,
  onAccept,
  onClear,
}: {
  selected: number;
  acceptable: number;
  reviewer: string;
  pending: boolean;
  onAccept: () => void;
  onClear: () => void;
}) {
  const skipped = selected - acceptable;
  const noReviewer = reviewer.trim() === "";
  return (
    <>
      <span className="type-label text-foreground tabular-nums">{selected} selected</span>
      {skipped > 0 && <span className="type-body text-muted-foreground">{skipped} already decided {skipped === 1 ? "is" : "are"} skipped</span>}
      {noReviewer && <span className="type-body text-muted-foreground">Enter your name as reviewer to accept.</span>}
      <span className="flex-1" />
      <Button size="sm" disabled={pending || noReviewer || acceptable === 0} onClick={onAccept}>
        {pending ? <Spinner data-icon="inline-start" /> : <CheckIcon aria-hidden="true" data-icon="inline-start" />}
        Accept {acceptable}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onClear} aria-label="Clear selection">
        <XIcon aria-hidden="true" data-icon="inline-start" />
        Clear
      </Button>
    </>
  );
}

export function ReviewQueueTable({
  rows,
  total,
  api,
  reviewer,
  activeId,
  onOpen,
  onDecided,
  emptyMessage,
}: {
  rows: ReviewItem[];
  total: number;
  api: Pick<ApiClient, "acceptReviewItems">;
  reviewer: string;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDecided: (items: ReviewItem[]) => void;
  emptyMessage: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(rows.length / REVIEW_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = rows.slice((current - 1) * REVIEW_PAGE_SIZE, current * REVIEW_PAGE_SIZE);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const selected = chosen.filter((id) => byId.has(id));
  const acceptable = selected.filter((id) => isWaiting(byId.get(id)!.reviewState));

  useEffect(() => {
    if (activeId === null) return;
    const index = rows.findIndex((row) => row.id === activeId);
    if (index !== -1) setPage(pageOf(index));
  }, [activeId, rows]);

  async function acceptSelected() {
    setError(null);
    setPending(true);
    try {
      const result = await api.acceptReviewItems(acceptable, reviewer.trim());
      onDecided(result.items);
      setChosen([]);
      toast.success(`Accepted ${result.items.length} ${result.items.length === 1 ? "item" : "items"}`);
      if (result.missing.length > 0) toast.warning(`${result.missing.length} no longer in the queue`);
    } catch (cause) {
      setError(`Decisions not saved: ${errorText(cause)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <WarningCircleIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        columns={columns}
        data={shown}
        getRowId={(item) => item.id}
        emptyMessage={emptyMessage}
        onRowClick={(item) => onOpen(item.id)}
        rowClassName={(item) => (item.id === activeId ? "bg-muted" : undefined)}
        enableRowSelection
        selectedIds={selected}
        onSelectionChange={setChosen}
        toolbar={
          selected.length > 0 ? (
            <BulkBar selected={selected.length} acceptable={acceptable.length} reviewer={reviewer} pending={pending} onAccept={() => void acceptSelected()} onClear={() => setChosen([])} />
          ) : undefined
        }
        footer={<TablePager page={current} pageCount={pageCount} onPage={setPage} summary={`${rows.length} of ${total} items · J and K move`} />}
      />
    </div>
  );
}
