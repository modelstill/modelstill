"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@modelstill/ui/components/chart";
import { cn } from "@modelstill/ui/lib/utils";

export type TrafficPoint = {
  label: string;
  total: number;
  student: number;
  deferred: number;
  mismatch: number;
  p95Student: number | null;
  p95Cloud: number | null;
};

type ChartProps = { data: TrafficPoint[]; className?: string };

const SIZE = "aspect-auto h-52 w-full";
const INITIAL = { width: 560, height: 208 };
const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 12 } as const;
const GRID = { vertical: false, stroke: "var(--grid)" } as const;
const BAR_RADIUS: [number, number, number, number] = [4, 4, 4, 4];
const STACK_TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const COMPARE_DASH = "3 3";

const requestsConfig = {
  total: { label: "Requests", color: "var(--chart-1)" },
} satisfies ChartConfig;

const mismatchConfig = {
  mismatch: { label: "Model mismatches", color: "var(--destructive)" },
} satisfies ChartConfig;

const deferralConfig = {
  student: { label: "Served by student", color: "var(--chart-1)" },
  deferred: { label: "Deferred to cloud", color: "var(--chart-compare)" },
} satisfies ChartConfig;

const latencyConfig = {
  p95Student: { label: "Student p95", color: "var(--chart-1)" },
  p95Cloud: { label: "Cloud p95", color: "var(--chart-compare)" },
} satisfies ChartConfig;

export function RequestsChart({ data, metric = "total", className }: ChartProps & { metric?: "total" | "mismatch" }) {
  const config = metric === "total" ? requestsConfig : mismatchConfig;
  return (
    <ChartContainer config={config} className={cn(SIZE, className)} initialDimension={INITIAL}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} minTickGap={32} />
        <YAxis {...AXIS} width={32} allowDecimals={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={BAR_RADIUS} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export function DeferralChart({ data, className }: ChartProps) {
  return (
    <ChartContainer config={deferralConfig} className={cn(SIZE, className)} initialDimension={INITIAL}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} minTickGap={32} />
        <YAxis {...AXIS} width={32} allowDecimals={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="student" stackId="split" fill="var(--color-student)" isAnimationActive={false} />
        <Bar dataKey="deferred" stackId="split" fill="var(--color-deferred)" radius={STACK_TOP_RADIUS} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export function LatencyChart({ data, className }: ChartProps) {
  return (
    <ChartContainer config={latencyConfig} className={cn(SIZE, className)} initialDimension={INITIAL}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} minTickGap={32} />
        <YAxis {...AXIS} width={40} domain={[0, "auto"]} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="p95Student" type="monotone" stroke="var(--color-p95Student)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="p95Cloud" type="monotone" stroke="var(--color-p95Cloud)" strokeWidth={1.5} strokeDasharray={COMPARE_DASH} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}
