"use client";

import { useState } from "react";
import { GaugeIcon, PulseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { GateChecks } from "@modelstill/ui/blocks/gate-checks";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import { ModeBadge, PassBadge } from "@/components/badges";
import { ServingModeControl } from "@/components/deployment/serving-mode-control";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, PanelSection, ToolbarNote } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { ResourceView } from "@/components/states";
import { EmptyCommand, TaskEmptyState } from "@/components/task-empty";
import type { Deployment } from "@/lib/api";
import { emptyPage } from "@/lib/empty-states";
import { formatDateTime } from "@/lib/format";
import { formatShare } from "@/lib/interval";
import { taskSectionHref } from "@/lib/nav";
import { useApiClient, useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function DeploymentCard({ deployment }: { deployment: Deployment }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="type-title">Gateway routing</CardTitle>
        <CardDescription className="text-[12.5px]">Below the confidence threshold a call goes to the cloud model, and both answers are logged.</CardDescription>
        <CardAction>
          <ModeBadge mode={deployment.mode} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-4">
        <KeyValueList
          layout="grid"
          items={[
            { label: "Student model", value: <ModelName model={deployment.studentModel} /> },
            { label: "Confidence threshold", value: deployment.threshold ?? "n/a", hint: "below it the call defers" },
            { label: "Target error", value: formatShare(deployment.targetError), hint: "the threshold is set for this" },
            { label: "Shadow sample", value: formatShare(deployment.shadowSample) },
            { label: "Active from", value: formatDateTime(deployment.activeFrom) },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export default function DeploymentPage() {
  const slug = useSlug();
  const api = useApiClient();
  const deployment = useResource((client) => client.getDeployment(slug), [slug]);
  const [saved, setSaved] = useState<{ slug: string; deployment: Deployment } | null>(null);
  const gates = useResource((api) => api.listGates(slug), [slug]);

  return (
    <ListPage toolbar={<ToolbarNote>A student is served only after its gate passes. The gateway still checks the model that answered on every call.</ToolbarNote>}>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "traffic")} icon={PulseIcon}>
          Traffic
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "monitoring")} icon={GaugeIcon}>
          Monitoring
        </HeaderLink>
      </PageActions>
      <ResourceView resource={deployment} loading="cards" empty="Not deployed" emptyState={<TaskEmptyState page={emptyPage("deployment", slug)} />}>
        {(loaded) => {
          const data = saved?.slug === slug ? saved.deployment : loaded;
          return (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <DeploymentCard deployment={data} />
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="type-title">Serving mode</CardTitle>
                  <CardDescription>Off sends every call to the cloud model, shadow runs the student on a sample, serve answers callers with it.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 px-4">
                  <ServingModeControl slug={slug} deployment={data} api={api} onSaved={(next) => setSaved({ slug, deployment: next })} />
                  <div className="flex flex-col gap-2">
                    <p className="type-body text-muted-foreground">To move the threshold, recalibrate on held-out data and push the deployment file.</p>
                    <EmptyCommand command={`modelstill serve calibrate calib.jsonl --target-error 0.05 --deployment ${slug}.deployment.yaml`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }}
      </ResourceView>
      <PanelSection
        title="Gate behind this deployment"
        actions={
          <HeaderLink href={taskSectionHref(slug, "gates")} icon={ShieldCheckIcon}>
            Gate history
          </HeaderLink>
        }
      >
        <ResourceView resource={gates} empty="No gate has run for this task yet.">
          {(rows) => {
            const latest = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
            return (
              <Card className="gap-0 py-0">
                <CardHeader className="border-b px-4 py-2.5 [.border-b]:pb-2.5">
                  <CardTitle className="flex items-center gap-2 text-[13px]">
                    <PassBadge passed={latest.passed} />
                    <span className="font-normal text-muted-foreground">{formatDateTime(latest.createdAt)}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                  <GateChecks checks={latest.checks} />
                </CardContent>
              </Card>
            );
          }}
        </ResourceView>
      </PanelSection>
    </ListPage>
  );
}
