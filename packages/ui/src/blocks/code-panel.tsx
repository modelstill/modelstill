"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@modelstill/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@modelstill/ui/components/tooltip";
import { highlight, type TokenKind } from "@modelstill/ui/lib/highlight";
import { cn } from "@modelstill/ui/lib/utils";

const TOKEN_CLASS: Record<TokenKind, string> = {
  string: "text-positive",
  keyword: "text-chart-5",
  flag: "text-brand-text",
  variable: "text-status-warn",
  plain: "text-foreground",
};

export function HighlightedCode({ code, className }: { code: string; className?: string }) {
  return (
    <pre data-slot="highlighted-code" className={cn("overflow-x-auto font-mono text-[12.5px] leading-[1.7]", className)}>
      <code>
        {highlight(code).map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function CopyIconButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? "Copied" : label}
            onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true))}
            className={cn("text-muted-foreground hover:text-foreground", className)}
          >
            {copied ? <CheckIcon className="text-positive" /> : <CopyIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{copied ? "Copied" : "Copy"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div data-slot="copy-field" className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-head pr-1.5 pl-4">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground">{value}</code>
      <CopyIconButton value={value} label={label ?? `Copy ${value}`} />
    </div>
  );
}

export type CodeTab = { value: string; label: ReactNode; icon?: ReactNode; code: string };

export function CodeTabs({ tabs, defaultValue, className }: { tabs: readonly CodeTab[]; defaultValue?: string; className?: string }) {
  const [active, setActive] = useState(defaultValue ?? tabs[0]?.value ?? "");
  const current = tabs.find((tab) => tab.value === active) ?? tabs[0];
  return (
    <Tabs value={active} onValueChange={setActive} data-slot="code-tabs" className={cn("gap-0 overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border pr-2 pl-3">
        <TabsList variant="line" className="h-11 gap-3 p-0">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="h-11 flex-none gap-1.5 rounded-none px-1 text-[13px] font-medium after:bottom-0">
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {current && <CopyIconButton value={current.code} label={`Copy ${typeof current.label === "string" ? current.label : "code"}`} />}
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="px-4 py-3.5">
          <HighlightedCode code={tab.code} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function ApiCallBlock({ title = "Equivalent API call", method, path, code, icon }: { title?: ReactNode; method: string; path: string; code: string; icon?: ReactNode }) {
  return (
    <div data-slot="api-call" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        {icon}
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        <span className="ml-auto flex min-w-0 items-center gap-2">
          <span className="rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground">{method}</span>
          <span className="truncate font-mono text-[12px] text-muted-foreground">{path}</span>
        </span>
      </div>
      <div className="relative bg-surface-head px-3.5 py-3">
        <CopyIconButton value={code} label="Copy the API call" className="absolute top-2 right-2" />
        <HighlightedCode code={code} className="pr-8" />
      </div>
    </div>
  );
}
