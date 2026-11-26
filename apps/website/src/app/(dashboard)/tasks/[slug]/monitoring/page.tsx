"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { IntervalValue } from "@modelstill/ui/blocks/interval-value";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { Section } from "@modelstill/ui/blocks/section";
import { AlertStatusBadge, PassBadge, SeverityBadge } from "@/components/badges";
import { FlaskIcon, PulseIcon } from "@phosphor-icons/react";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarNote } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { taskSectionHref } from "@/lib/nav";
import { ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { emptyPage } from "@/lib/empty-states";
import type { Alert, CanaryRun } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

const canaryColumns: ColumnDef<CanaryRun>[] = [
  {
    accessorKey: "createdAt",
    header: "Ran",
    cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
  },
  { accessorKey: "provider", header: "Provider", cell: ({ row }) => <span className="font-mono text-xs">{row.original.provider}</span> },
  {
    id: "passed",
    accessorFn: (run) => `${run.passed}/${run.total}`,
    header: "Passed",
    meta: { align: "right" },
    enableSorting: false,
  },
  {
    id: "rate",
    accessorFn: (run) => (run.total === 0 ? -1 : run.passed / run.total),
    header: "Pass rate with interval",
    cell: ({ row }) => {
      const run = row.original;
      return <IntervalValue mean={run.total === 0 ? null : run.passed / run.total} low={run.low} high={run.high} />;
    },
  },
  {
    id: "allPassed",
    accessorFn: (run) => (run.total > 0 ? Number(run.passed === run.total) : -1),
    header: "All passed",
    cell: ({ row }) => <PassBadge passed={row.original.total > 0 ? row.original.passed === row.original.total : null} pendingLabel="no cases" />,
  },
];

function payloadSummary(payload: unknown): string {
  if (payload === null || payload === undefined) return "no details";
  if (typeof payload !== "object") return String(payload);
  const keys = Object.keys(payload as Record<string, unknown>);
  return keys.length === 0 ? "no details" : keys.slice(0, 4).join(", ") + (keys.length > 4 ? ` +${keys.length - 4}` : "");
}

const alertColumns: ColumnDef<Alert>[] = [
  {
    accessorKey: "createdAt",
    header: "Raised",
    cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
  },
  { accessorKey: "severity", header: "Severity", cell: ({ row }) => <SeverityBadge severity={row.original.severity} /> },
  { accessorKey: "kind", header: "Kind", cell: ({ row }) => <span className="font-mono text-xs">{row.original.kind}</span> },
  {
    id: "status",
    accessorFn: (alert) => (alert.ackedAt ? 1 : 0),
    header: "Status",
    cell: ({ row }) => <AlertStatusBadge ackedAt={row.original.ackedAt} />,
  },
  {
    id: "details",
    header: "Details",
    enableSorting: false,
    cell: ({ row }) => <span className="block max-w-80 truncate font-mono text-xs text-muted-foreground">{payloadSummary(row.original.payload)}</span>,
  },
];

function AlertDetail({ alert }: { alert: Alert }) {
  return (
    <>
      <KeyValueList
        items={[
          { label: "Severity", value: <SeverityBadge severity={alert.severity} /> },
          { label: "Kind", value: <span className="font-mono text-xs">{alert.kind}</span> },
          { label: "Raised", value: formatDateTime(alert.createdAt) },
          { label: "Status", value: <AlertStatusBadge ackedAt={alert.ackedAt} />, hint: alert.ackedAt ? `acked ${formatDateTime(alert.ackedAt)}` : undefined },
        ]}
      />
      <Section title="Payload">
        <JsonView value={alert.payload} />
      </Section>
    </>
  );
}

export default function MonitoringPage() {
  const slug = useSlug();
  const canaries = useResource((api) => api.listCanaries(slug), [slug]);
  const alerts = useResource((api) => api.listAlerts(slug), [slug]);
  return (
    <ListPage toolbar={<ToolbarNote>Known-answer canaries per provider, and alerts raised for this task</ToolbarNote>}>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "traffic")} icon={PulseIcon}>
          Traffic
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "evals")} icon={FlaskIcon}>
          Evals
        </HeaderLink>
      </PageActions>
      <Section title="Canary runs" description="pass rates with exact intervals">
        <ResourceView resource={canaries} empty="No canary has run for this task yet." emptyState={<TaskEmptyState page={emptyPage("monitoring", slug)} />}>
          {(runs) => (
            <DataTable
              columns={canaryColumns}
              data={runs}
              getRowId={(run) => `${run.provider}-${run.createdAt}`}
              maxHeight="22rem"
              footer={`${runs.length} runs`}
              initialSorting={[{ id: "createdAt", desc: true }]}
            />
          )}
        </ResourceView>
      </Section>
      <Section title="Alerts" description="click an alert for its payload">
        <ResourceView resource={alerts} empty="No alerts" emptyDescription="Nothing has drifted or failed.">
          {(rows) => (
            <DataTable
              columns={alertColumns}
              data={rows}
              getRowId={(alert) => alert.id}
              initialSorting={[{ id: "createdAt", desc: true }]}
              detail={{ title: (alert) => alert.kind, description: (alert) => `Raised ${formatDateTime(alert.createdAt)}`, render: (alert) => <AlertDetail alert={alert} /> }}
            />
          )}
        </ResourceView>
      </Section>
    </ListPage>
  );
}
