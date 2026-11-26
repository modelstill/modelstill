import type { ComponentType, ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "@phosphor-icons/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import type { Delta } from "@modelstill/ui/lib/delta";
import { filledSegments, heatLevel, meterRatio, TONE_FILL, type MeterTone } from "@modelstill/ui/lib/meter";
import { cn } from "@modelstill/ui/lib/utils";

export type MetricWidgetProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function MetricWidget({ title, description, children, className }: MetricWidgetProps) {
  return (
    <Card data-slot="metric-widget" className={cn("gap-0 rounded-2xl bg-surface-head py-0", className)}>
      <CardContent className="flex flex-1 items-start justify-center px-6 pt-7 pb-5 sm:px-8">{children}</CardContent>
      <CardHeader className="gap-1 px-6 pb-6">
        <CardTitle className="text-[15px] leading-5 font-medium text-foreground">{title}</CardTitle>
        {description && <CardDescription className="text-[13px] leading-5">{description}</CardDescription>}
      </CardHeader>
    </Card>
  );
}

export type WidgetPanelProps = {
  label: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function WidgetPanel({ label, value, unit, delta, children, className }: WidgetPanelProps) {
  return (
    <div
      data-slot="widget-panel"
      className={cn(
        "flex w-full max-w-[340px] flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_24/0.04),0_6px_16px_-8px_rgb(16_16_24/0.08)]",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] leading-4 text-muted-foreground">{label}</span>
        {value !== undefined && (
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-[19px] leading-6 text-foreground tabular-nums">{value}</span>
            {unit && <span className="font-mono text-[11.5px] text-muted-foreground">{unit}</span>}
          </span>
        )}
        {delta}
      </div>
      {children}
    </div>
  );
}

const DELTA_ICON: Record<Delta["direction"], ComponentType<{ className?: string; weight?: "bold" }>> = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  flat: MinusIcon,
};

const DELTA_TONE: Record<Delta["tone"], string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-muted-foreground",
};

export function DeltaLine({ delta, context, empty = "no earlier value" }: { delta: Delta | null; context: ReactNode; empty?: ReactNode }) {
  if (!delta) return <span className="font-mono text-[11.5px] leading-4 text-muted-foreground">{empty}</span>;
  const Icon = DELTA_ICON[delta.direction];
  return (
    <span data-slot="delta-line" data-tone={delta.tone} className="flex items-center gap-2 font-mono text-[11.5px] leading-4">
      <span className={cn("inline-flex items-center gap-0.5 tabular-nums", DELTA_TONE[delta.tone])}>
        {delta.magnitude}
        <Icon aria-label={delta.direction} weight="bold" className="size-3" />
      </span>
      <span className="text-muted-foreground">{context}</span>
    </span>
  );
}

export function SignedDelta({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  return <span className={cn("font-mono text-[12px] tabular-nums", DELTA_TONE[delta.tone])}>{delta.signed}</span>;
}

export type BarSparklineProps = { values: readonly number[]; highlight?: number; labels?: readonly string[]; className?: string };

export function BarSparkline({ values, highlight = values.length - 1, labels, className }: BarSparklineProps) {
  const max = Math.max(...values, 0);
  return (
    <div data-slot="bar-sparkline" className={cn("flex h-28 items-end justify-center gap-2.5 px-1", className)}>
      {values.map((value, index) => (
        <span
          key={index}
          title={labels?.[index]}
          data-highlight={index === highlight || undefined}
          className={cn(
            "w-2.5 shrink-0 rounded-full",
            index === highlight ? "bg-linear-to-b from-brand/45 to-brand" : "bg-muted ring-1 ring-border ring-inset",
          )}
          style={{ height: `${Math.max(12, meterRatio(value, max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export type ShareSegment = { key: string; label: ReactNode; value: number; tone: "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "mark"; display?: ReactNode };

const SEGMENT_FILL: Record<ShareSegment["tone"], string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
  mark: "bg-mark",
};

export function ShareBar({ segments }: { segments: readonly ShareSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div data-slot="share-bar" className="flex h-2 w-full gap-1.5">
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <span key={segment.key} className={cn("h-full min-w-1.5 rounded-full", SEGMENT_FILL[segment.tone])} style={{ flexGrow: total === 0 ? 1 : segment.value }} />
        ))}
    </div>
  );
}

export function ShareTable({ heading, valueHeading, segments }: { heading: ReactNode; valueHeading: ReactNode; segments: readonly ShareSegment[] }) {
  return (
    <table data-slot="share-table" className="w-full text-left">
      <thead>
        <tr>
          <th className="pb-2 type-label text-muted-foreground">{heading}</th>
          <th className="pb-2 type-label text-muted-foreground">{valueHeading}</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((segment) => (
          <tr key={segment.key} className="text-[13px] text-foreground">
            <td className="py-1">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className={cn("size-2 rounded-full", SEGMENT_FILL[segment.tone])} />
                {segment.label}
              </span>
            </td>
            <td className="py-1 font-mono text-[12.5px] tabular-nums">{segment.display ?? segment.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GradientBars({ values, labels }: { values: readonly number[]; labels?: readonly string[] }) {
  const max = Math.max(...values, 0);
  return (
    <div data-slot="gradient-bars" className="flex h-32 items-end gap-1.5">
      {values.map((value, index) => (
        <span
          key={index}
          title={labels?.[index]}
          className="flex-1 rounded-lg bg-linear-to-b from-brand/45 via-brand/75 to-brand"
          style={{ height: `${Math.max(6, meterRatio(value, max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function TickProgress({ value, max = 1, ticks = 36, label }: { value: number; max?: number; ticks?: number; label?: string }) {
  const filled = filledSegments(value, max, ticks);
  return (
    <div
      data-slot="tick-progress"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="flex h-11 items-stretch justify-between gap-[3px]"
    >
      {Array.from({ length: ticks }, (_, index) => (
        <span key={index} data-on={index < filled || undefined} className={cn("w-[3px] rounded-full", index < filled ? "bg-brand" : "bg-muted ring-1 ring-border ring-inset")} />
      ))}
    </div>
  );
}

const HEAT_FILL = ["bg-muted ring-1 ring-border ring-inset", "bg-brand/20", "bg-brand/40", "bg-brand/70", "bg-brand"];

export function HeatmapGrid({ cells, columns = 12, labels }: { cells: readonly (number | null)[]; columns?: number; labels?: readonly string[] }) {
  const max = Math.max(0, ...cells.map((cell) => cell ?? 0));
  return (
    <div data-slot="heatmap-grid" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {cells.map((cell, index) => (
        <span key={index} title={labels?.[index]} data-level={heatLevel(cell, max)} className={cn("aspect-square rounded-[4px]", HEAT_FILL[heatLevel(cell, max)])} />
      ))}
    </div>
  );
}

export type LabelledBar = { key: string; label: ReactNode; value: number; tone?: MeterTone; display?: ReactNode };

export function LabelledBars({ rows, max }: { rows: readonly LabelledBar[]; max?: number }) {
  const top = max ?? Math.max(0, ...rows.map((row) => row.value));
  return (
    <div data-slot="labelled-bars" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <span className="font-mono text-[12px] text-foreground">{row.label}</span>
          <span className="h-2.5">
            {row.value > 0 && <span className={cn("block h-full rounded-full", TONE_FILL[row.tone ?? "brand"])} style={{ width: `${Math.max(4, meterRatio(row.value, top) * 100)}%` }} />}
          </span>
          <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">{row.display ?? row.value}</span>
        </div>
      ))}
    </div>
  );
}
