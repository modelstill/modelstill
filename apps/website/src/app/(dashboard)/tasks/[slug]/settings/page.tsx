"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { Button } from "@modelstill/ui/components/button";
import { ModeBadge } from "@/components/badges";
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/dashboard/layout";
import { ResourceView } from "@/components/states";
import { EmptyCommand } from "@/components/task-empty";
import type { TaskVersion } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatShare } from "@/lib/interval";
import { taskSectionHref } from "@/lib/nav";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

const versionColumns: ColumnDef<TaskVersion>[] = [
  { accessorKey: "version", header: "Version", cell: ({ row }) => <span className="font-medium">{row.original.version}</span> },
  { accessorKey: "snapshotHash", header: "Snapshot hash", enableSorting: false, cell: ({ row }) => <CodeId value={row.original.snapshotHash} /> },
  { accessorKey: "gitSha", header: "Git sha", enableSorting: false, cell: ({ row }) => <CodeId value={row.original.gitSha} length={10} /> },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
  },
];

export default function TaskSettingsPage() {
  const slug = useSlug();
  const task = useResource((api) => api.getTask(slug), [slug]);
  const versions = useResource((api) => api.listVersions(slug), [slug]);
  const deployment = useResource((api) => api.getDeployment(slug), [slug]);

  return (
    <SettingsPage>
      <SettingsSection title="Task details" description="The spec in your repository is the source of truth; pushing it again registers a new version.">
        <SettingsCard>
          <SettingsRow label="Slug">
            <span className="font-mono text-[12.5px]">{slug}</span>
          </SettingsRow>
          <SettingsRow label="Current version" hint="the version new runs and gates are recorded against">
            {task.status === "ready" ? task.data.version : "..."}
          </SettingsRow>
          <SettingsRow label="Snapshot hash" hint="hash of the spec as pushed">
            {task.status === "ready" ? <CodeId value={task.data.snapshotHash} length={16} /> : "..."}
          </SettingsRow>
          <SettingsRow label="Push a new version">
            <div className="w-[340px] max-w-full">
              <EmptyCommand command={`modelstill push task tasks/${slug}/spec.yaml`} />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Routing"
        description="How the gateway answers calls for this task. Change it in the deployment file, then calibrate."
        actions={
          <Button asChild size="sm" variant="outline" className="px-2">
            <Link href={taskSectionHref(slug, "deployment")}>Open deployment</Link>
          </Button>
        }
      >
        <SettingsCard>
          <SettingsRow label="Serving mode">{task.status === "ready" ? <ModeBadge mode={task.data.mode} /> : "..."}</SettingsRow>
          <SettingsRow label="Student model">
            {deployment.status === "ready" && deployment.data ? <ModelName model={deployment.data.studentModel} /> : <span className="text-muted-foreground">not deployed</span>}
          </SettingsRow>
          <SettingsRow label="Deferral share" hint="share of calls the student sent to the cloud">
            {task.status === "ready" ? formatShare(task.data.deferralShare) : "..."}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Versions" description="Every spec version pushed for this task.">
        <ResourceView resource={versions} empty="No versions recorded yet.">
          {(rows) => <DataTable columns={versionColumns} data={rows} getRowId={(row) => row.id} initialSorting={[{ id: "createdAt", desc: true }]} />}
        </ResourceView>
      </SettingsSection>
    </SettingsPage>
  );
}
