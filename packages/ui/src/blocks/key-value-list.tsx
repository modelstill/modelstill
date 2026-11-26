import type { ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";

export type KeyValueItem = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  key?: string;
};

export type KeyValueListProps = {
  items: KeyValueItem[];
  layout?: "rows" | "grid";
  className?: string;
};

export function KeyValueList({ items, layout = "rows", className }: KeyValueListProps) {
  return (
    <dl
      data-slot="key-value-list"
      data-layout={layout}
      className={cn(
        layout === "rows"
          ? "grid grid-cols-[minmax(8rem,auto)_1fr] divide-y [&>div]:col-span-2 [&>div]:grid [&>div]:grid-cols-subgrid"
          : "grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={item.key ?? index} className={cn(layout === "rows" ? "items-center gap-4 py-1.5" : "flex min-w-0 flex-col gap-1")}>
          <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
          <dd className="flex min-w-0 flex-col gap-0.5 tabular-nums">
            <span className="flex min-w-0 items-center gap-2">{item.value}</span>
            {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
