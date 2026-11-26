"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { GateChecks, gateSummary } from "@modelstill/ui/blocks/gate-checks";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@modelstill/ui/components/collapsible";
import { PassBadge } from "@/components/badges";
import { ArrowsLeftRightIcon, FileTextIcon, FlaskIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { GateChanges } from "@/components/evals/gate-changes";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarNote } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { compareHref, evalRunHref, gateReportHref, taskSectionHref } from "@/lib/nav";
import { ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { emptyPage } from "@/lib/empty-states";
import type { Gate } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function GateRuns({ slug, gate }: { slug: string; gate: Gate }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
      <Button asChild variant="ghost" size="xs">
        <Link href={gateReportHref(slug, gate.id)}>
          <FileTextIcon aria-hidden="true" data-icon="inline-start" />
          Report
        </Link>
      </Button>
      {gate.evalRunId && (
      <Button asChild variant="ghost" size="xs">
        <Link href={evalRunHref(slug, gate.evalRunId)}>
          <FlaskIcon aria-hidden="true" data-icon="inline-start" />
          Gated run
        </Link>
      </Button>
      )}
      {gate.evalRunId && gate.previousEvalRunId && (
        <>
          <Button asChild variant="ghost" size="xs">
            <Link href={evalRunHref(slug, gate.previousEvalRunId)}>
              <FlaskIcon aria-hidden="true" data-icon="inline-start" />
              Baseline run
            </Link>
          </Button>
          <Button asChild variant="ghost" size="xs">
            <Link href={compareHref(slug, gate.previousEvalRunId, gate.evalRunId)}>
              <ArrowsLeftRightIcon aria-hidden="true" data-icon="inline-start" />
              Compare
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}

function GateRow({ slug, gate, defaultOpen }: { slug: string; gate: Gate; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const scoreChange = gate.changes?.find((change) => change.name === "score");
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="group/gate flex h-10 w-full items-center gap-3 px-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
        <CaretRightIcon aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-data-[state=open]/gate:rotate-90" />
        <PassBadge passed={gate.passed} />
        <span>{formatDateTime(gate.createdAt)}</span>
        {scoreChange && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {scoreChange.improved} cases improved, {scoreChange.regressed} regressed
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{gateSummary(gate.checks)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t bg-muted/20">
        <GateRuns slug={slug} gate={gate} />
        {gate.changes && gate.evalRunId && gate.previousEvalRunId && (
          <div className="border-b">
            <GateChanges slug={slug} before={gate.previousEvalRunId} after={gate.evalRunId} changes={gate.changes} />
          </div>
        )}
        <GateChecks checks={gate.checks} showSummary={false} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function GatesPage() {
  const slug = useSlug();
  const gates = useResource((api) => api.listGates(slug), [slug]);
  return (
    <ListPage toolbar={<ToolbarNote>Each gate keeps every threshold and measured value, so a decision can be re-read later</ToolbarNote>}>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "evals")} icon={FlaskIcon}>
          Eval runs
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "deployment")} icon={RocketLaunchIcon} primary>
          Deployment
        </HeaderLink>
      </PageActions>
      <ResourceView resource={gates} empty="No gate has run for this task yet." emptyState={<TaskEmptyState page={emptyPage("gates", slug)} />}>
        {(rows) => (
          <div className="overflow-hidden rounded-lg border bg-card">
            {[...rows]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((gate, index) => (
                <GateRow key={gate.id} slug={slug} gate={gate} defaultOpen={index === 0} />
              ))}
          </div>
        )}
      </ResourceView>
    </ListPage>
  );
}
