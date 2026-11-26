"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon, ArrowRightIcon, DatabaseIcon, FlaskIcon, KanbanIcon, RowsIcon } from "@phosphor-icons/react";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { CountBadge } from "@modelstill/ui/blocks/table-cells";
import { Button } from "@modelstill/ui/components/button";
import { Input } from "@modelstill/ui/components/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@modelstill/ui/components/sheet";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { cn } from "@modelstill/ui/lib/utils";
import { ReviewStateBadge } from "@/components/badges";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarSpacer } from "@/components/dashboard/layout";
import { CrumbBadge, PageActions } from "@/components/dashboard/page-actions";
import { ReviewItemCard } from "@/components/review/review-item-card";
import { differing, ReviewQueueTable } from "@/components/review/review-queue-table";
import { ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { emptyPage } from "@/lib/empty-states";
import type { ReviewItem } from "@/lib/api";
import { stepIndex } from "@/lib/flow";
import { taskSectionHref } from "@/lib/nav";
import { isWaiting, reviewSummary } from "@/lib/review";
import { isTypingTarget } from "@/lib/shortcuts";
import { useApiClient, useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

const REVIEWER_KEY = "modelstill.reviewer";

type View = "waiting" | "decided" | "all";
type Layout = "table" | "board";

function useReviewer(): [string, (name: string) => void] {
  const [reviewer, setReviewer] = useState("");
  useEffect(() => setReviewer(window.localStorage.getItem(REVIEWER_KEY) ?? ""), []);
  const update = (name: string) => {
    setReviewer(name);
    window.localStorage.setItem(REVIEWER_KEY, name);
  };
  return [reviewer, update];
}

const QUEUE_LIMIT = 500;

function matches(view: View, item: ReviewItem): boolean {
  if (view === "all") return true;
  return view === "waiting" ? isWaiting(item.reviewState) : !isWaiting(item.reviewState);
}

function BoardColumn({ title, items, onOpen, activeId }: { title: string; items: ReviewItem[]; onOpen: (id: string) => void; activeId: string | null }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-sidebar/60 p-2">
      <h2 className="flex items-center justify-between px-1 type-label">
        {title}
        <span className="text-[12px] font-normal text-muted-foreground tabular-nums">{items.length}</span>
      </h2>
      {items.length === 0 && <p className="px-1 py-6 text-center text-[12px] text-muted-foreground">Nothing here.</p>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          className={cn(
            "flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40",
            activeId === item.id && "border-primary/60",
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <CodeId value={item.inputHash} length={12} />
            <ReviewStateBadge state={item.reviewState} />
          </span>
          <span className="text-[12px] text-muted-foreground">
            {item.teacherOutputs.length} answers · {differing(item)} fields differ
          </span>
        </button>
      ))}
    </section>
  );
}

function DatasetBanner({ slug, decided }: { slug: string; decided: number }) {
  if (decided === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-brand-wash px-3 py-2 text-[13px] text-brand-text">
      <DatabaseIcon aria-hidden="true" className="size-4" />
      <span>
        {decided} decided {decided === 1 ? "item is" : "items are"} now labelled in the dataset, ready for the next training run.
      </span>
      <Button asChild size="sm" variant="outline" className="ml-auto gap-1.5 bg-background px-2 text-[12px]">
        <Link href={taskSectionHref(slug, "datasets")}>
          Open dataset
          <ArrowRightIcon aria-hidden="true" className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

function Queue({
  slug,
  current,
  reviewer,
  view,
  layout,
  query,
  onDecided,
}: {
  slug: string;
  current: ReviewItem[];
  reviewer: string;
  view: View;
  layout: Layout;
  query: string;
  onDecided: (items: ReviewItem[]) => void;
}) {
  const api = useApiClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const rows = current.filter((item) => matches(view, item) && item.inputHash.toLowerCase().includes(needle));
  const active = activeId === null ? undefined : current.find((item) => item.id === activeId);
  const summary = reviewSummary(current);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key !== "j" && event.key !== "k") return;
      const index = activeId === null ? null : rows.findIndex((item) => item.id === activeId);
      const next = stepIndex(index === -1 ? null : index, event.key === "j" ? 1 : -1, rows.length);
      if (next === null) return;
      event.preventDefault();
      setActiveId(rows[next]!.id);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, activeId]);

  return (
    <>
      <DatasetBanner slug={slug} decided={summary.decided} />
      {layout === "table" ? (
        <ReviewQueueTable
          rows={rows}
          total={current.length}
          api={api}
          reviewer={reviewer}
          activeId={activeId}
          onOpen={setActiveId}
          onDecided={onDecided}
          emptyMessage={view === "waiting" ? "Nothing waits for a reviewer." : "No item matches this view."}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <BoardColumn title="Waiting for a reviewer" items={current.filter((item) => isWaiting(item.reviewState))} onOpen={setActiveId} activeId={activeId} />
          <BoardColumn title="Decided" items={current.filter((item) => !isWaiting(item.reviewState))} onOpen={setActiveId} activeId={activeId} />
        </div>
      )}
      <Sheet open={active !== undefined} onOpenChange={(open) => !open && setActiveId(null)}>
        <SheetContent className="w-full gap-0 sm:max-w-xl">
          {active && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle>Review item</SheetTitle>
                <SheetDescription>
                  Agreement {active.agreement === null ? "n/a" : active.agreement.toFixed(2)} across {active.teacherOutputs.length} answers · J and K move
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <ReviewItemCard
                  key={active.id}
                  item={active}
                  api={api}
                  reviewer={reviewer}
                  onDecided={(item) => onDecided([item])}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function ReviewQueuePage() {
  const slug = useSlug();
  const queue = useResource((client) => client.listReviewQueue(slug, QUEUE_LIMIT), [slug]);
  const [reviewer, setReviewer] = useReviewer();
  const [view, setView] = useState<View>("waiting");
  const [layout, setLayout] = useState<Layout>("table");
  const [query, setQuery] = useState("");
  const reviewerId = useId();
  const [decided, setDecided] = useState<Record<string, ReviewItem>>({});
  const current = useMemo(() => (queue.status === "ready" ? queue.data.map((item) => decided[item.id] ?? item) : []), [queue, decided]);
  const summary = queue.status === "ready" ? reviewSummary(current) : null;

  return (
    <ListPage
      toolbar={
        <>
          <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(value) => value && setView(value as View)} aria-label="Filter by state">
            <ToggleGroupItem value="waiting" className="h-7 gap-1.5 px-2.5 text-[12px]">
              Waiting
              {summary && <span className="text-muted-foreground tabular-nums">{summary.pending}</span>}
            </ToggleGroupItem>
            <ToggleGroupItem value="decided" className="h-7 gap-1.5 px-2.5 text-[12px]">
              Decided
              {summary && <span className="text-muted-foreground tabular-nums">{summary.decided}</span>}
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="h-7 px-2.5 text-[12px]">
              All
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" variant="outline" value={layout} onValueChange={(value) => value && setLayout(value as Layout)} aria-label="Layout">
            <ToggleGroupItem value="table" aria-label="Table" className="h-7 px-2">
              <RowsIcon className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="board" aria-label="Board" className="h-7 px-2">
              <KanbanIcon className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="relative w-full max-w-56">
            <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search input hash..." aria-label="Search input hash" className="h-7 pl-7 text-[12.5px]" />
          </div>
          <ToolbarSpacer />
          <div className="flex items-center gap-2">
            <label htmlFor={reviewerId} className="text-[12px] text-muted-foreground">
              Reviewer
            </label>
            <Input id={reviewerId} value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="your name" className="h-7 w-40 text-[13px]" />
          </div>
        </>
      }
    >
      <CrumbBadge>{summary && summary.pending > 0 && <CountBadge>{summary.pending} new</CountBadge>}</CrumbBadge>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "evals")} icon={FlaskIcon}>
          Eval runs
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "datasets")} icon={DatabaseIcon} primary>
          Dataset
        </HeaderLink>
      </PageActions>
      <ResourceView resource={queue} empty="The review queue is empty." emptyState={<TaskEmptyState page={emptyPage("review", slug)} />}>
        {() => (
          <Queue
            slug={slug}
            current={current}
            reviewer={reviewer}
            view={view}
            layout={layout}
            query={query}
            onDecided={(saved) => setDecided((map) => ({ ...map, ...Object.fromEntries(saved.map((item) => [item.id, item])) }))}
          />
        )}
      </ResourceView>
    </ListPage>
  );
}
