"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { cn } from "@modelstill/ui/lib/utils";

export type CodeBlockProps = {
  code: string;
  label?: string;
  className?: string;
};

export function CodeBlock({ code, label, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = () => {
    void navigator.clipboard?.writeText(code).then(() => setCopied(true));
  };

  return (
    <div data-slot="code-block" className={cn("min-w-0 overflow-hidden rounded-md border bg-muted/40", className)}>
      <div className="flex h-9 items-center justify-between gap-2 border-b px-3">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={copied ? "Copied" : `Copy ${label ?? "code"}`}
          onClick={onCopy}
          className="text-muted-foreground"
        >
          {copied ? <CheckIcon aria-hidden="true" className="text-success" /> : <CopyIcon aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
