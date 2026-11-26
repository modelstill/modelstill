"use client";

import { ChartCard } from "@modelstill/ui/blocks/chart-card";
import { HistogramChart } from "@modelstill/ui/blocks/histogram-chart";
import type { HistogramBin } from "@/lib/api";
import { metricLabel } from "@/lib/format";
import { histogramRows } from "@/lib/run-detail";

export function MetricHistogram({ metric, bins }: { metric: string; bins: HistogramBin[] }) {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  return (
    <div data-testid="metric-histogram" data-metric={metric} className="min-w-0">
      <ChartCard
        title={metric === "score" ? "case score" : metricLabel(metric)}
        description={`${total} cases by value`}
      >
        <HistogramChart data={histogramRows(bins)} />
      </ChartCard>
    </div>
  );
}
