"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { cn } from "@modelstill/ui/lib/utils";

export function truncateId(value: string, length = 12): string {
  const colon = value.indexOf(":");
  if (colon === -1) return value.slice(0, length);
  return `${value.slice(0, colon + 1)}${value.slice(colon + 1, colon + 1 + length)}`;
}

export type CodeIdProps = {
  value: string | null | undefined;
  length?: number;
  copy?: boolean;
  className?: string;
};

export function CodeId({ value, length = 12, copy = true, className }: CodeIdProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!value) return <span className={cn("font-mono text-xs text-muted-foreground", className)}>n/a</span>;

  const onCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    void navigator.clipboard?.writeText(value).then(() => setCopied(true));
  };

  return (
    <span data-slot="code-id" title={value} className={cn("group/code-id inline-flex max-w-full items-center gap-0.5", className)}>
      <code className="truncate font-mono text-xs">{truncateId(value, length)}</code>
      {copy && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Copy ${value}`}
          onClick={onCopy}
          className="text-muted-foreground opacity-60 group-hover/code-id:opacity-100 focus-visible:opacity-100"
        >
          {copied ? <CheckIcon aria-hidden="true" className="text-success" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      )}
    </span>
  );
}
