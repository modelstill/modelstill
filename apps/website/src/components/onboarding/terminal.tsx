import type { ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";
import { ExampleTag } from "@/components/auth/distil-scene";

export function TerminalPanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "mx-auto w-full max-w-[520px] overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-[0_24px_64px_-28px_rgba(14,116,144,0.35)]",
        className,
      )}
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-muted/60 px-3">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ml-2 truncate font-mono text-[12px] text-muted-foreground">{title}</span>
        <ExampleTag className="ml-auto shrink-0" />
      </div>
      <div className="space-y-2 px-4 py-4 font-mono text-[12.5px] leading-5">{children}</div>
    </div>
  );
}

export function TerminalLine({ prompt = false, tone = "plain", children }: { prompt?: boolean; tone?: "plain" | "quiet" | "ok"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "break-all whitespace-pre-wrap",
        tone === "quiet" && "text-muted-foreground",
        tone === "ok" && "text-brand-text",
        tone === "plain" && "text-foreground",
      )}
    >
      {prompt && <span className="mr-2 text-brand-text">$</span>}
      {children}
    </p>
  );
}
