import type { ReactNode } from "react";
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { Badge } from "@modelstill/ui/components/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@modelstill/ui/components/card";
import { cn } from "@modelstill/ui/lib/utils";

export type TrendDirection = "up" | "down" | "flat";

export type StatTrend = {
  value: ReactNode;
  direction: TrendDirection;
  positive?: Exclude<TrendDirection, "flat">;
};

export type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  sublabel?: ReactNode;
  trend?: StatTrend;
  interval?: { low: number; high: number; digits?: number };
  action?: ReactNode;
  className?: string;
};

const TREND_ICON = { up: ArrowUpRightIcon, down: ArrowDownRightIcon, flat: ArrowRightIcon } as const;

function trendVariant(trend: StatTrend): "success" | "danger" | "secondary" {
  if (trend.direction === "flat") return "secondary";
  return trend.direction === (trend.positive ?? "up") ? "success" : "danger";
}

function TrendBadge({ trend }: { trend: StatTrend }) {
  const Icon = TREND_ICON[trend.direction];
  return (
    <Badge variant={trendVariant(trend)}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {trend.value}
    </Badge>
  );
}

export function StatCard({ label, value, sublabel, trend, interval, action, className }: StatCardProps) {
  const digits = interval?.digits ?? 2;
  return (
    <Card data-slot="stat-card" className={cn("gap-3 py-3.5", className)}>
      <CardHeader className="px-4">
        <CardDescription className="truncate text-sm leading-4">{label}</CardDescription>
        {action && <CardAction className="-my-1">{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[22px] leading-none font-medium tracking-[-0.01em] tabular-nums">{value}</span>
          {interval && (
            <span className="text-xs text-muted-foreground tabular-nums">
              [{interval.low.toFixed(digits)}, {interval.high.toFixed(digits)}]
            </span>
          )}
          {trend && <TrendBadge trend={trend} />}
        </div>
        {sublabel && <p className="truncate text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
