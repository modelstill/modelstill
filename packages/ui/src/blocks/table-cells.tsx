import type { ComponentType, ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Badge } from "@modelstill/ui/components/badge";
import { Button } from "@modelstill/ui/components/button";
import { Pagination, PaginationContent, PaginationItem } from "@modelstill/ui/components/pagination";
import { filledSegments, scoreTone, TONE_FILL, usageTone, type MeterTone, type ScoreBands } from "@modelstill/ui/lib/meter";
import { cn } from "@modelstill/ui/lib/utils";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

export function HeaderLabel({ icon: IconComponent, children }: { icon: Icon; children: ReactNode }) {
  return (
    <span data-slot="header-label" className="inline-flex items-center gap-2">
      <IconComponent aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      {children}
    </span>
  );
}

export type SegmentMeterProps = { filled: number; segments: number; tone: MeterTone; shape?: "dot" | "tick"; label?: string; className?: string };

export function SegmentMeter({ filled, segments, tone, shape = "dot", label, className }: SegmentMeterProps) {
  return (
    <span data-slot="segment-meter" data-tone={tone} role="img" aria-label={label} className={cn("inline-flex items-center", shape === "dot" ? "gap-[3px]" : "gap-0.5", className)}>
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          data-on={index < filled || undefined}
          className={cn(shape === "dot" ? "h-2.5 w-[7px] rounded-[2px]" : "h-3.5 w-1 rounded-[1px]", index < filled ? TONE_FILL[tone] : "bg-muted ring-1 ring-border ring-inset")}
        />
      ))}
    </span>
  );
}

export type ScoreMeterProps = { value: number | null | undefined; max?: number; segments?: number; bands?: ScoreBands; format?: (value: number) => string; className?: string };

export function ScoreMeter({ value, max = 1, segments = 12, bands, format = (score) => (Number.isInteger(score) ? String(score) : score.toFixed(2)), className }: ScoreMeterProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted-foreground">n/a</span>;
  const tone = scoreTone(value, max, bands);
  return (
    <span data-slot="score-meter" className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="w-9 text-right font-mono text-[12.5px] text-foreground tabular-nums">{format(value)}</span>
      <SegmentMeter filled={filledSegments(value, max, segments)} segments={segments} tone={tone} label={`${format(value)} of ${format(max)}`} />
    </span>
  );
}

export type UsageMeterProps = { used: number; limit: number | null; segments?: number; format?: (value: number) => string; noLimit?: ReactNode };

export function UsageMeter({ used, limit, segments = 20, format = String, noLimit = "No limit" }: UsageMeterProps) {
  const tone = usageTone(used, limit);
  return (
    <span data-slot="usage-meter" className="inline-flex flex-col gap-1">
      <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
        {limit === null ? (
          noLimit
        ) : (
          <>
            <span className="text-foreground">{format(used)}</span> / {format(limit)}
          </>
        )}
      </span>
      <SegmentMeter shape="tick" filled={limit === null ? 0 : filledSegments(used, limit, segments)} segments={segments} tone={tone} label={limit === null ? "no limit" : `${format(used)} of ${format(limit)}`} />
    </span>
  );
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "secondary";

export function StatusPill({ tone, icon: IconComponent, children }: { tone: StatusTone; icon?: Icon; children: ReactNode }) {
  return (
    <Badge variant={tone} className="h-[22px] rounded-md px-2 text-[12px]">
      {IconComponent && <IconComponent aria-hidden="true" />}
      {children}
    </Badge>
  );
}

export function NameCell({ icon: IconComponent, name, secondary }: { icon?: Icon; name: ReactNode; secondary?: ReactNode }) {
  return (
    <span data-slot="name-cell" className="flex min-w-0 items-center gap-3">
      {IconComponent && (
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground shadow-[0_1px_1px_rgb(16_16_24/0.04)]">
          <IconComponent className="size-3.5" />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] leading-4 font-medium text-foreground">{name}</span>
        {secondary && <span className="truncate font-mono text-[11.5px] leading-4 text-muted-foreground">{secondary}</span>}
      </span>
    </span>
  );
}

export function ChipList({ items, max = 2 }: { items: readonly string[]; max?: number }) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <span data-slot="chip-list" className="inline-flex flex-wrap items-center gap-1.5">
      {shown.map((item) => (
        <Badge key={item} variant="outline" className="h-[22px] rounded-md px-1.5 font-normal">
          {item}
        </Badge>
      ))}
      {rest > 0 && (
        <Badge variant="outline" className="h-[22px] rounded-md px-1.5 font-normal text-muted-foreground" title={items.slice(max).join(", ")}>
          +{rest}
        </Badge>
      )}
    </span>
  );
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="success" className="h-[22px] rounded-md px-2 text-[12px]">
      {children}
    </Badge>
  );
}

export type TablePagerProps = { page: number; pageCount?: number; onPage?: (page: number) => void; summary?: ReactNode; previousDisabled?: boolean; nextDisabled?: boolean };

export function TablePager({ page, pageCount, onPage, summary, previousDisabled, nextDisabled }: TablePagerProps) {
  const total = pageCount === undefined ? null : Math.max(1, pageCount);
  return (
    <div data-slot="table-pager" className="flex w-full items-center justify-between gap-3">
      <span className="text-[13px] text-muted-foreground tabular-nums">
        Page {page}
        {total !== null && ` of ${total}`}
        {summary && <span className="ml-2">· {summary}</span>}
      </span>
      <Pagination className="mx-0 w-auto">
        <PaginationContent className="gap-1.5">
          <PaginationItem>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous page" disabled={previousDisabled ?? page <= 1} onClick={() => onPage?.(page - 1)} className="text-muted-foreground">
              <CaretLeftIcon />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <span aria-current="page" className="grid h-6 min-w-6 place-items-center rounded-md bg-primary px-1.5 font-mono text-[12px] text-primary-foreground tabular-nums">
              {page}
            </span>
          </PaginationItem>
          <PaginationItem>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Next page" disabled={nextDisabled ?? (total === null || page >= total)} onClick={() => onPage?.(page + 1)} className="text-muted-foreground">
              <CaretRightIcon />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
