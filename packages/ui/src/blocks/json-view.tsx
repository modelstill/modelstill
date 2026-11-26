"use client";

import { cn } from "@modelstill/ui/lib/utils";
import { JsonRenderer } from "@modelstill/ui/vendor/helicone/json-renderer";

export type JsonViewProps = {
  value: unknown;
  collapsed?: boolean;
  copy?: boolean;
  maxHeight?: number;
  framed?: boolean;
  className?: string;
};

export function JsonView({ value, collapsed = false, copy = true, maxHeight, framed = true, className }: JsonViewProps) {
  const body = (
    <div className={cn("font-mono text-xs", framed && "p-2.5")}>
      <JsonRenderer data={value} isExpanded={!collapsed} showCopyButton={copy} />
    </div>
  );
  return (
    <div data-slot="json-view" className={cn("min-w-0", framed && "rounded-md border bg-muted/40", className)}>
      {maxHeight ? <div style={{ maxHeight }} className="overflow-auto">{body}</div> : body}
    </div>
  );
}
