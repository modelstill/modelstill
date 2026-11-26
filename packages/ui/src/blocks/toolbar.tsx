import type { ComponentProps } from "react";
import { cn } from "@modelstill/ui/lib/utils";

export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return <div role="toolbar" data-slot="toolbar" className={cn("flex min-w-0 flex-wrap items-center gap-2", className)} {...props} />;
}

export function ToolbarSpacer() {
  return <span aria-hidden="true" className="flex-1" />;
}

export function ToolbarText({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("text-xs text-muted-foreground tabular-nums", className)} {...props} />;
}
