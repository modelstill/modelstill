import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { cn } from "@modelstill/ui/lib/utils";
import type { MetricDirection } from "@/lib/compare";

const ICON = { improved: ArrowUpIcon, regressed: ArrowDownIcon } as const;

const TONE: Record<MetricDirection, string> = { improved: "text-status-ok", regressed: "text-status-fail" };

function Count({
  direction,
  count,
  onPick,
  href,
}: {
  direction: MetricDirection;
  count: number;
  onPick?: () => void;
  href?: string;
}) {
  const Icon = ICON[direction];
  const content = (
    <>
      <Icon aria-hidden="true" weight="bold" data-icon="inline-start" />
      <span className="tabular-nums">{count}</span> {direction}
    </>
  );
  if (count === 0 || (!onPick && !href)) {
    return (
      <span data-direction={direction} className={cn("inline-flex h-6 items-center gap-1 px-1.5 text-xs", count === 0 ? "text-muted-foreground" : TONE[direction])}>
        {content}
      </span>
    );
  }
  if (href) {
    return (
      <Button asChild variant="ghost" size="xs" className={TONE[direction]}>
        <Link href={href} data-direction={direction}>
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="xs" className={TONE[direction]} data-direction={direction} onClick={onPick}>
      {content}
    </Button>
  );
}

export function ChangeCounts({
  improved,
  regressed,
  onPick,
  hrefFor,
  className,
}: {
  improved: number;
  regressed: number;
  onPick?: (direction: MetricDirection) => void;
  hrefFor?: (direction: MetricDirection) => string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-0.5", className)}>
      <Count direction="improved" count={improved} onPick={onPick && (() => onPick("improved"))} href={hrefFor?.("improved")} />
      <Count direction="regressed" count={regressed} onPick={onPick && (() => onPick("regressed"))} href={hrefFor?.("regressed")} />
    </span>
  );
}
