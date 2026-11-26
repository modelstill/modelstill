"use client";

import { useState } from "react";
import { ChartCard } from "@modelstill/ui/blocks/chart-card";
import { StatCard } from "@modelstill/ui/blocks/stat-card";
import { CountUp } from "@/components/motion/count-up";
import { DeferralChart, LatencyChart, RequestsChart } from "@modelstill/ui/blocks/traffic-charts";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { BarbellIcon, DatabaseIcon, GaugeIcon, ListChecksIcon } from "@phosphor-icons/react";
import { HeaderLink } from "@/components/dashboard/header-link";
import { ListPage, ToolbarNote, ToolbarSpacer } from "@/components/dashboard/layout";
import { PageActions } from "@/components/dashboard/page-actions";
import { ResourceView } from "@/components/states";
import { TaskEmptyState, UnlockTiles } from "@/components/task-empty";
import { RequestList } from "@/components/traffic/request-list";
import { emptyPage } from "@/lib/empty-states";
import type { Traffic } from "@/lib/api";
import { formatShare } from "@/lib/interval";
import { taskSectionHref } from "@/lib/nav";
import { trafficRows, trafficTotals } from "@/lib/traffic";
import { useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

const WINDOWS = [
  { hours: 24, label: "24 h" },
  { hours: 72, label: "3 d" },
  { hours: 168, label: "7 d" },
] as const;

function TrafficView({ slug, traffic, hours }: { slug: string; traffic: Traffic; hours: number }) {
  const rows = trafficRows(traffic.buckets);
  const totals = trafficTotals(traffic.buckets);
  const span = `last ${hours} h`;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Deferral share" value={formatShare(traffic.deferralShare)} sublabel="calls sent to the cloud" />
        <StatCard label="Requests" value={<CountUp value={totals.total} />} sublabel={span} />
        <StatCard label="Served by student" value={<CountUp value={totals.student} />} sublabel={`${totals.deferred.toLocaleString()} deferred`} />
        <StatCard label="Model mismatches" value={<CountUp value={totals.mismatch} />} sublabel="deferred on a model mismatch" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <ChartCard title="Requests per hour" description={span}>
          <RequestsChart data={rows} />
        </ChartCard>
        <ChartCard title="Served by student vs deferred" description={span}>
          <DeferralChart data={rows} />
        </ChartCard>
        <ChartCard title="Model mismatches" description={span}>
          <RequestsChart data={rows} metric="mismatch" />
        </ChartCard>
        <ChartCard title="p95 latency per side" description="milliseconds">
          <LatencyChart data={rows} />
        </ChartCard>
      </div>
      <RequestList slug={slug} />
    </>
  );
}

export default function TrafficPage() {
  const slug = useSlug();
  const [hours, setHours] = useState<number>(24);
  const traffic = useResource((api) => api.getTraffic(slug, hours), [slug, hours]);
  return (
    <ListPage
      toolbar={
        <>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={String(hours)}
            onValueChange={(value) => value && setHours(Number(value))}
            aria-label="Time window"
          >
            {WINDOWS.map((option) => (
              <ToggleGroupItem key={option.hours} value={String(option.hours)} className="h-7 px-2.5 text-[12px]">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToolbarSpacer />
          <ToolbarNote>Gateway calls for this task, split by who answered</ToolbarNote>
        </>
      }
    >
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "monitoring")} icon={GaugeIcon}>
          Monitoring
        </HeaderLink>
        <HeaderLink href={taskSectionHref(slug, "review")} icon={ListChecksIcon}>
          Review queue
        </HeaderLink>
      </PageActions>
      <ResourceView resource={traffic} loading="cards" empty="No traffic in this window." emptyState={
          <TaskEmptyState
            page={emptyPage("traffic", slug)}
            unlocks={
              <UnlockTiles
                heading="Opens up once calls flow through the gateway"
                tiles={[
                  { label: "Monitoring", description: "Canaries and alerts when a provider drifts", icon: GaugeIcon, href: taskSectionHref(slug, "monitoring") },
                  { label: "Review", description: "Cases where the answers disagree", icon: ListChecksIcon, href: taskSectionHref(slug, "review") },
                  { label: "Datasets", description: "Deferred calls become labelled rows", icon: DatabaseIcon, href: taskSectionHref(slug, "datasets") },
                  { label: "Training", description: "A student trained on those rows", icon: BarbellIcon, href: taskSectionHref(slug, "training") },
                ]}
              />
            }
          />
        } isEmptyData={(data) => data.buckets.length === 0}>
        {(data) => <TrafficView slug={slug} traffic={data} hours={hours} />}
      </ResourceView>
    </ListPage>
  );
}
