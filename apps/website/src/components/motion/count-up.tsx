"use client";

import { CountingNumber } from "./counting-number";
import { formatCount } from "@/lib/motion";

export function CountUp({ value, format = formatCount, fallback = "n/a" }: { value: number | null | undefined; format?: (value: number) => string; fallback?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <>{fallback}</>;
  return <CountingNumber number={value} format={format} />;
}
