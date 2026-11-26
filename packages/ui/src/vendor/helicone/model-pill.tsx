/*
 * Adapted from Helicone, web/components/templates/requests/modelPill.tsx
 * Copyright 2023 Helicone Inc. Licensed under the Apache License, Version 2.0 (see LICENSE in this folder).
 * Modified for ModelStill: no provider mapping or author colours, one neutral style from this app's tokens.
 */
import { cn } from "@modelstill/ui/lib/utils";

export function ModelPill({ model, className }: { model: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-5 max-w-full truncate rounded-sm bg-secondary px-1.5 align-middle font-mono text-xs/5 text-secondary-foreground ring-1 ring-inset ring-border",
        className,
      )}
      title={model ?? undefined}
    >
      {model && model !== "" ? model : "unknown"}
    </span>
  );
}
