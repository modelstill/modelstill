"use client";

import { DatabaseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarNote } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { taskSectionHref } from "@/lib/nav";
import { ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { emptyPage } from "@/lib/empty-states";
import { TrainRunsTable } from "@/components/training/train-runs-table";
import { LIVE_REFRESH_MS } from "@/lib/training";
import { usePolling, useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

export default function TrainingRunsPage() {
  const slug = useSlug();
  const runs = useResource((api) => api.listTrainRuns(slug), [slug]);
  const live = runs.status === "ready" && runs.data.some((run) => run.status === "running");
  usePolling(runs.refresh, LIVE_REFRESH_MS, live);

  return (
    <ListPage toolbar={<ToolbarNote>Every run pushed for this task, newest first. Running runs refresh on their own</ToolbarNote>}>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "datasets")} icon={DatabaseIcon}>
          Dataset
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "gates")} icon={ShieldCheckIcon} primary>
          Gates
        </HeaderLink>
      </PageActions>
      <ResourceView resource={runs} empty="No training runs recorded yet." emptyState={<TaskEmptyState page={emptyPage("training", slug)} />}>
        {(rows) => <TrainRunsTable slug={slug} runs={rows} />}
      </ResourceView>
    </ListPage>
  );
}
