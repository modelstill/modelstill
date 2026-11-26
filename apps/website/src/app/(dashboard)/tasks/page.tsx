"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { LabelledBars, MetricWidget, ShareBar, ShareTable, WidgetPanel, type ShareSegment } from "@modelstill/ui/blocks/metric-widget";
import { ModeBadge, PassBadge } from "@/components/badges";
import { ListPage, ToolbarNote } from "@/components/dashboard/layout";
import { ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { emptyPage } from "@/lib/empty-states";
import type { Task } from "@/lib/api";
import { formatShare } from "@/lib/interval";
import { taskHref } from "@/lib/nav";
import { useResource } from "@/lib/use-api";
import { modeCounts, taskGateStates } from "@/lib/widgets";

const columns: ColumnDef<Task>[] = [
  {
    accessorKey: "slug",
    header: "Task",
    cell: ({ row }) => (
      <Link
        href={taskHref(row.original.slug)}
        onClick={(event) => event.stopPropagation()}
        className="font-mono text-xs font-medium hover:underline"
      >
        {row.original.slug}
      </Link>
    ),
  },
  { accessorKey: "version", header: "Version" },
  { accessorKey: "snapshotHash", header: "Snapshot", enableSorting: false, cell: ({ row }) => <CodeId value={row.original.snapshotHash} /> },
  { accessorKey: "mode", header: "Mode", cell: ({ row }) => <ModeBadge mode={row.original.mode} /> },
  {
    accessorKey: "deferralShare",
    header: "Deferral share",
    meta: { align: "right" },
    sortUndefined: "last",
    cell: ({ row }) => formatShare(row.original.deferralShare),
  },
  {
    id: "lastGate",
    accessorFn: (task) => (task.lastGatePassed === null ? -1 : Number(task.lastGatePassed)),
    header: "Last gate",
    cell: ({ row }) => <PassBadge passed={row.original.lastGatePassed} />,
  },
];

function Summary({ tasks }: { tasks: Task[] }) {
  const gates = taskGateStates(tasks);
  const modes = modeCounts(tasks);
  const segments: ShareSegment[] = [
    { key: "serve", label: "Serving", value: modes.serve, tone: "chart-1" },
    { key: "shadow", label: "Shadow", value: modes.shadow, tone: "chart-3" },
    { key: "off", label: "Off", value: modes.off, tone: "mark" },
  ];
  const deferral = tasks.filter((task) => task.deferralShare !== null);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <MetricWidget title="Serving modes" description="Where each task's answers come from today.">
        <WidgetPanel label="Tasks" value={tasks.length} unit="registered">
          <ShareBar segments={segments} />
          <ShareTable heading="Mode" valueHeading="Tasks" segments={segments} />
        </WidgetPanel>
      </MetricWidget>
      <MetricWidget title="Gate outcomes by state" description="The latest gate of every task.">
        <WidgetPanel label="Latest gate" value={gates.passed} unit={`of ${tasks.length} passing`}>
          <LabelledBars
            max={tasks.length}
            rows={[
              { key: "passed", label: "Passed", value: gates.passed, tone: "positive" },
              { key: "failed", label: "Failed", value: gates.failed, tone: "negative" },
              { key: "none", label: "No gate", value: gates.none, tone: "idle" },
            ]}
          />
        </WidgetPanel>
      </MetricWidget>
      <MetricWidget title="Deferral share" description="Share of calls each task sends to the cloud model.">
        <WidgetPanel label="Tasks with traffic" value={deferral.length} unit={`of ${tasks.length}`}>
          {deferral.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-muted-foreground">No task has served traffic yet.</p>
          ) : (
            <LabelledBars
              max={100}
              rows={deferral.map((task) => ({ key: task.slug, label: task.slug, value: Math.round((task.deferralShare ?? 0) * 100), tone: "brand", display: formatShare(task.deferralShare) }))}
            />
          )}
        </WidgetPanel>
      </MetricWidget>
    </div>
  );
}

export default function TasksPage() {
  const router = useRouter();
  const tasks = useResource((api) => api.listTasks(), []);
  return (
    <ListPage toolbar={<ToolbarNote>Every task with its serving mode, deferral share and latest gate</ToolbarNote>}>
      <ResourceView resource={tasks} empty="No tasks yet" emptyState={<TaskEmptyState page={emptyPage("tasks", "")} />}>
        {(rows) => (
          <>
            <Summary tasks={rows} />
            <DataTable
              columns={columns}
              data={rows}
              getRowId={(task) => task.slug}
              onRowClick={(task) => router.push(taskHref(task.slug))}
              initialSorting={[{ id: "slug", desc: false }]}
              columnToggle
              footer={`${rows.length} tasks`}
            />
          </>
        )}
      </ResourceView>
    </ListPage>
  );
}
