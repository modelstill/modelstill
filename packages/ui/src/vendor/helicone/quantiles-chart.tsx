/*
 * Adapted from Helicone, web/components/templates/dashboard/quantilesGraph.tsx
 * Copyright 2023 Helicone Inc. Licensed under the Apache License, Version 2.0 (see LICENSE in this folder).
 * Modified for ModelStill: presentational only (data passed in, no hooks, no org or mock data),
 * series are passed by the caller and not stacked, colours come from this app's chart tokens. Moved to packages/ui (/ui).
 */
"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@modelstill/ui/components/chart";
import type { ChartConfig } from "@modelstill/ui/components/chart";

export type QuantileSeries = { key: string; label: string; color: string };

export function QuantilesChart({
  data,
  xKey,
  series,
  unit,
  className = "h-[220px] w-full",
}: {
  data: Record<string, string | number | null>[];
  xKey: string;
  series: QuantileSeries[];
  unit: string;
  className?: string;
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
  return (
    <ChartContainer config={config} className={className} initialDimension={{ width: 520, height: 220 }}>
      <AreaChart data={data}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.35} />
              <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} />
        <YAxis domain={[0, "auto"]} tickLine={false} axisLine={false} width={48} unit={unit} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type="monotone"
            fill={`url(#fill-${s.key})`}
            stroke={`var(--color-${s.key})`}
            strokeWidth={1.5}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
