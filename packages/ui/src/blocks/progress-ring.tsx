import { meterRatio } from "@modelstill/ui/lib/meter";
import { cn } from "@modelstill/ui/lib/utils";

export type ProgressRingProps = { value: number; max?: number; size?: number; stroke?: number; label?: string; className?: string };

export function ProgressRing({ value, max = 1, size = 16, stroke = 2, label, className }: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = meterRatio(value, max);
  return (
    <svg
      data-slot="progress-ring"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90", className)}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-border" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        className="stroke-brand transition-[stroke-dashoffset] duration-500 ease-[var(--motion-ease)]"
      />
    </svg>
  );
}
