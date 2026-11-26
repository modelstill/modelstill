/*
 * Adapted from Helicone, web/components/templates/requests/components/chatComponent/single/JsonRenderer.tsx
 * Copyright 2023 Helicone Inc. Licensed under the Apache License, Version 2.0 (see LICENSE in this folder).
 * Modified for ModelStill: Phosphor icons instead of heroicons, this app's tokens instead of slate/violet,
 * accepts unknown values, no long-string expander.
 */
"use client";

import { useState } from "react";
import { CaretDownIcon, CaretRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";

const DEFAULT_COLLAPSE_LENGTH = 10;

type JsonRendererProps = {
  data: unknown;
  level?: number;
  isExpanded?: boolean;
  showCopyButton?: boolean;
};

function Punct({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export function JsonRenderer({ data, level = 0, isExpanded = true, showCopyButton = true }: JsonRendererProps) {
  const shouldAutoCollapse = Array.isArray(data) && data.length > DEFAULT_COLLAPSE_LENGTH;
  const [expanded, setExpanded] = useState(shouldAutoCollapse ? false : isExpanded);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (data === null || data === undefined) return <span className="text-muted-foreground">null</span>;
  if (typeof data === "boolean") return <span className="font-medium text-warning">{String(data)}</span>;
  if (typeof data === "number") return <span className="text-warning">{data}</span>;
  if (typeof data === "string") {
    return <span className="whitespace-pre-wrap text-success">{level === 0 ? data : JSON.stringify(data)}</span>;
  }

  const isArray = Array.isArray(data);
  const entries: [string, unknown][] = isArray
    ? (data as unknown[]).map((value, index) => [String(index), value])
    : Object.entries(data as Record<string, unknown>);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) return <Punct>{open + close}</Punct>;

  return (
    <div className="relative font-mono text-xs leading-5">
      {level === 0 && showCopyButton && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-0 right-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Copy JSON"
        >
          {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
        </button>
      )}
      <button
        type="button"
        className="group inline-flex cursor-pointer items-center"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDownIcon className="mr-1 inline size-3 text-muted-foreground group-hover:text-foreground" />
        ) : (
          <CaretRightIcon className="mr-1 inline size-3 text-muted-foreground group-hover:text-foreground" />
        )}
        <Punct>{open}</Punct>
        {!expanded && (
          <span className="text-xs text-muted-foreground italic">
            ...{entries.length} {isArray ? "items" : "properties"}
          </span>
        )}
        {!expanded && <Punct>{close}</Punct>}
      </button>
      {expanded && (
        <div className="ml-4 border-l border-border pl-2">
          {entries.map(([key, value], index) => (
            <div key={key}>
              {!isArray && (
                <>
                  <span className="text-muted-foreground">&quot;{key}&quot;</span>
                  <Punct>: </Punct>
                </>
              )}
              <JsonRenderer data={value} level={level + 1} showCopyButton={false} />
              {index < entries.length - 1 && <Punct>,</Punct>}
            </div>
          ))}
        </div>
      )}
      {expanded && (
        <div className="ml-3">
          <Punct>{close}</Punct>
        </div>
      )}
    </div>
  );
}
