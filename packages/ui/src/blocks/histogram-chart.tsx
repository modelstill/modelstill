"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@modelstill/ui/components/chart";
import { cn } from "@modelstill/ui/lib/utils";

export type HistogramPoint = { range: string; count: number };

const SIZE = "aspect-auto h-40 w-full";
const INITIAL = { width: 360, height: 160 };
const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 11 } as const;
const GRID = { vertical: false, stroke: "var(--grid)" } as const;
const BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

const config = { count: { label: "Cases", color: "var(--chart-1)" } } satisfies ChartConfig;

export function HistogramChart({ data, className }: { data: HistogramPoint[]; className?: string }) {
  return (
    <ChartContainer config={config} className={cn(SIZE, className)} initialDimension={INITIAL}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="range" {...AXIS} minTickGap={16} />
        <YAxis {...AXIS} width={40} interval={0} allowDecimals={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={BAR_RADIUS} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
