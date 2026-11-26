"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@modelstill/ui/components/chart";
import { cn } from "@modelstill/ui/lib/utils";

export type StepRow = { step: number } & Record<string, number | null>;

export type StepSeries = { key: string; label: string; color?: string; dashed?: boolean };

const SIZE = "aspect-auto h-52 w-full";
const INITIAL = { width: 560, height: 208 };
const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 12 } as const;
const GRID = { vertical: false, stroke: "var(--grid)" } as const;
const PALETTE = ["var(--chart-1)", "var(--chart-compare)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const COMPARE_DASH = "3 3";
const DRAW_IN_MS = 450;

function compact(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1000 || magnitude < 0.01) return value.toExponential(1);
  return Number(value.toPrecision(3)).toString();
}

export function StepChart({ data, series, className, drawIn = false }: { data: StepRow[]; series: StepSeries[]; className?: string; drawIn?: boolean }) {
  const config = Object.fromEntries(
    series.map((entry, index) => [entry.key, { label: entry.label, color: entry.color ?? PALETTE[index % PALETTE.length] }]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer
      config={config}
      className={cn(SIZE, className)}
      initialDimension={INITIAL}
      data-series={series.map((entry) => entry.key).join(" ")}
      data-draw-in={drawIn || undefined}
    >
      <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} {...AXIS} minTickGap={32} allowDecimals={false} />
        <YAxis {...AXIS} width={44} domain={["auto", "auto"]} tickFormatter={compact} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(_, payload) => `step ${payload?.[0]?.payload?.step ?? ""}`} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((entry) => (
          <Line
            key={entry.key}
            dataKey={entry.key}
            type="monotone"
            stroke={`var(--color-${entry.key})`}
            strokeWidth={1.5}
            strokeDasharray={entry.dashed ? COMPARE_DASH : undefined}
            dot={false}
            connectNulls
            isAnimationActive={drawIn}
            animationBegin={0}
            animationDuration={DRAW_IN_MS}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
