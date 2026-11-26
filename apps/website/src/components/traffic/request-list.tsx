"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowsSplitIcon, ClockIcon, CloudIcon, CoinsIcon, CpuIcon, InfoIcon, ListChecksIcon, PaperPlaneTiltIcon, RobotIcon, StackIcon, TimerIcon } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { StatusPill, TablePager } from "@modelstill/ui/blocks/table-cells";
import { Section } from "@modelstill/ui/blocks/section";
import { Alert, AlertDescription, AlertTitle } from "@modelstill/ui/components/alert";
import { Button } from "@modelstill/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@modelstill/ui/components/empty";
import { Field, FieldLabel } from "@modelstill/ui/components/field";
import { Input } from "@modelstill/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@modelstill/ui/components/select";
import { Spinner } from "@modelstill/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { PanelSection } from "@/components/dashboard/layout";
import { ErrorState, LoadingState } from "@/components/states";
import type { ServedRequest } from "@/lib/cases-api";
import { taskSectionHref } from "@/lib/nav";
import {
  dayRange,
  deferralReason,
  formatCost,
  formatLatency,
  formatRequestTime,
  requestSearch,
  reviewCandidateFromRequest,
  type DeferredFilter,
  type RequestFilters,
} from "@/lib/requests";
import { useApiClient, useResource } from "@/lib/use-api";
import { useCasesApi } from "@/lib/use-cases-api";
import { AddToDatasetDialog } from "./add-to-dataset-dialog";

const PAGE_SIZE = 50;
const ALL_TASKS = "__all";

function DeferredBadge({ deferred }: { deferred: boolean }) {
  return deferred ? (
    <StatusPill tone="warning" icon={CloudIcon}>
      Deferred
    </StatusPill>
  ) : (
    <StatusPill tone="info" icon={CpuIcon}>
      Student
    </StatusPill>
  );
}

const columns: ColumnDef<ServedRequest>[] = [
  { accessorKey: "ts", header: "Time", meta: { icon: ClockIcon }, cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums">{formatRequestTime(row.original.ts)}</span> },
  { accessorKey: "task", header: "Task", meta: { icon: StackIcon }, cell: ({ row }) => <span className="text-[13px]">{row.original.task}</span> },
  {
    accessorKey: "answeredBy",
    header: "Answered by",
    meta: { icon: RobotIcon },
    cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.answeredBy ?? "unknown"}</span>,
  },
  {
    accessorKey: "latencyMs",
    header: "Latency",
    meta: { align: "right", icon: TimerIcon },
    sortUndefined: "last",
    cell: ({ row }) => <span className="tabular-nums">{formatLatency(row.original.latencyMs)}</span>,
  },
  {
    accessorKey: "costUsd",
    header: "Cost",
    meta: { align: "right", icon: CoinsIcon },
    cell: ({ row }) => <span className="tabular-nums">{formatCost(row.original.costUsd)}</span>,
  },
  { accessorKey: "deferred", header: "Served from", meta: { icon: ArrowsSplitIcon }, cell: ({ row }) => <DeferredBadge deferred={row.original.deferred} /> },
];

export function RequestTable({
  requests,
  renderDetail,
  footer,
}: {
  requests: ServedRequest[];
  renderDetail: (request: ServedRequest) => ReactNode;
  footer: ReactNode;
}) {
  return (
    <DataTable
      columns={columns}
      data={requests}
      getRowId={(request) => request.id}
      emptyMessage="No request matches these filters."
      footer={footer}
      detail={{
        title: (request) => `Request at ${formatRequestTime(request.ts)}`,
        description: (request) => `${request.task}, answered by ${request.answeredBy ?? "unknown"}`,
        render: renderDetail,
      }}
    />
  );
}

function Answer({ testId, text, empty }: { testId: string; text: string | null; empty: string }) {
  return (
    <div data-testid={testId} className="rounded-md border bg-muted/40 p-2.5">
      {text === null ? (
        <span className="text-[12px] text-muted-foreground">{empty}</span>
      ) : (
        <pre className="font-mono text-[12px] break-words whitespace-pre-wrap">{text}</pre>
      )}
    </div>
  );
}

export function RequestDetail({
  request,
  onAddToReview,
  addToDataset,
}: {
  request: ServedRequest;
  onAddToReview: (request: ServedRequest) => Promise<void>;
  addToDataset: ReactNode;
}) {
  const [sending, setSending] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            try {
              await onAddToReview(request);
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? <Spinner data-icon="inline-start" /> : <PaperPlaneTiltIcon aria-hidden="true" data-icon="inline-start" />}
          Add to review
        </Button>
        {addToDataset}
      </div>
      <KeyValueList
        items={[
          { label: "Time", value: formatRequestTime(request.ts) },
          { label: "Task", value: request.task },
          { label: "Answered by", value: <span className="font-mono text-[12px]">{request.answeredBy ?? "unknown"}</span> },
          { label: "Served from", value: <DeferredBadge deferred={request.deferred} /> },
          { label: "Mode", value: request.mode },
          { label: "Latency", value: `${formatLatency(request.latencyMs)} (student ${formatLatency(request.studentMs)}, cloud ${formatLatency(request.cloudMs)})` },
          { label: "Cost", value: `${formatCost(request.costUsd)} (student ${formatCost(request.studentCostUsd)}, cloud ${formatCost(request.cloudCostUsd)})` },
          { label: "Confidence", value: request.confidence === null ? "n/a" : request.confidence.toFixed(2) },
          { label: "Model check", value: request.modelMatch === null ? "n/a" : request.modelMatch ? "the deployed student answered" : "another model answered" },
        ]}
      />
      <Section title="Request">
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>The request body is not stored</AlertTitle>
          <AlertDescription>
            <span>
              The gateway logs only a hash of each request, together with both answers. The hash identifies the request; the messages themselves are gone.
            </span>
            <CodeId value={request.requestHash} length={16} />
          </AlertDescription>
        </Alert>
      </Section>
      <Section title="Student answer" description={request.studentModel ?? undefined}>
        <Answer testId="student-answer" text={request.studentOutput} empty="No student answer was logged for this request." />
      </Section>
      <Section title="Cloud answer" description={request.cloudModel ?? undefined}>
        <Answer testId="cloud-answer" text={request.cloudOutput} empty="No cloud answer: the student's answer was served." />
      </Section>
      <Section title="Deferral">
        <p data-testid="deferral-reason" className="text-[13px]">
          {deferralReason(request)}
        </p>
      </Section>
    </>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <Field orientation="horizontal" className="w-auto gap-1.5">
      <FieldLabel htmlFor={id} className="text-[12px] font-normal text-muted-foreground">
        {label}
      </FieldLabel>
      <Input id={id} type="date" value={value} onChange={(event) => event.target.value && onChange(event.target.value)} className="h-7 w-[150px] text-[12px]" />
    </Field>
  );
}

export function RequestList({ slug }: { slug: string }) {
  const api = useApiClient();
  const cases = useCasesApi();
  const router = useRouter();
  const initialRange = useMemo(() => dayRange(new Date(), 7), []);
  const [filters, setFilters] = useState<RequestFilters>({ task: slug, deferred: "all", ...initialRange });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const search = requestSearch(filters, cursor, PAGE_SIZE);
  const page = useResource(() => cases.listRequests(search), [search, "requests"]);
  const tasks = useResource((client) => client.listTasks(), ["tasks-for-requests"]);
  const update = (next: Partial<RequestFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setCursors([null]);
  };

  const addToReview = async (request: ServedRequest) => {
    try {
      const queued = await api.sendToReview(request.task, [reviewCandidateFromRequest(request)]);
      toast.success(queued === 1 ? "In the review queue" : `${queued} in the review queue`, {
        description: `A reviewer settles the answer for ${request.task}.`,
        action: { label: "Open queue", onClick: () => router.push(taskSectionHref(request.task, "review")) },
      });
    } catch (error) {
      toast.error("Could not add to review", { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const taskNames = tasks.status === "ready" ? tasks.data.map((task) => task.slug) : [slug];

  return (
    <PanelSection
      title="Requests"
      description="Each call through the gateway, newest first"
      actions={
        <>
          <Select value={filters.task ?? ALL_TASKS} onValueChange={(value) => update({ task: value === ALL_TASKS ? null : value })}>
            <SelectTrigger size="sm" className="w-auto min-w-36" aria-label="Task">
              <SelectValue>{filters.task ?? "All tasks"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_TASKS}>All tasks</SelectItem>
                {taskNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={filters.deferred}
            onValueChange={(value) => value && update({ deferred: value as DeferredFilter })}
            aria-label="Deferred"
          >
            <ToggleGroupItem value="all" className="h-7 px-2.5 text-[12px]">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="deferred" className="h-7 px-2.5 text-[12px]">
              Deferred
            </ToggleGroupItem>
            <ToggleGroupItem value="student" className="h-7 px-2.5 text-[12px]">
              Student
            </ToggleGroupItem>
          </ToggleGroup>
          <DateField label="From" value={filters.from ?? initialRange.from} onChange={(from) => update({ from })} />
          <DateField label="To" value={filters.to ?? initialRange.to} onChange={(to) => update({ to })} />
        </>
      }
    >
      {page.status === "loading" && <LoadingState variant="table" />}
      {page.status === "error" && <ErrorState error={page.error} onRetry={page.reload} />}
      {page.status === "ready" && page.data.requests.length === 0 && cursors.length === 1 && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No requests in this range</EmptyTitle>
            <EmptyDescription>Widen the dates, pick another task, or clear the deferred filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {page.status === "ready" && (page.data.requests.length > 0 || cursors.length > 1) && (
        <RequestTable
          requests={page.data.requests}
          renderDetail={(request) => (
            <RequestDetail request={request} onAddToReview={addToReview} addToDataset={<AddToDatasetDialog request={request} />} />
          )}
          footer={
            <TablePager
              page={cursors.length}
              summary={`${page.data.requests.length} ${page.data.requests.length === 1 ? "request" : "requests"}`}
              previousDisabled={cursors.length === 1}
              nextDisabled={page.data.nextCursor === null}
              onPage={(next) =>
                next < cursors.length ? setCursors((stack) => stack.slice(0, -1)) : page.data.nextCursor && setCursors((stack) => [...stack, page.data.nextCursor])
              }
            />
          }
        />
      )}
    </PanelSection>
  );
}
