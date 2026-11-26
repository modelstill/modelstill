"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CaretDown, Check, Copy, FileText } from "@phosphor-icons/react";
import { markdownPath } from "@/lib/markdown-path";
import { DOCS_URL } from "@/lib/site";

export function PageActions({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const md = markdownPath(path);
  const prompt = encodeURIComponent(`Read ${DOCS_URL}${md} so I can ask questions about ModelStill.`);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const copy = async () => {
    const text = await (await fetch(md)).text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const item =
    "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-fd-foreground hover:bg-fd-accent hover:text-fd-accent-foreground";

  return (
    <div ref={menu} className="relative flex shrink-0 items-stretch self-start rounded-lg border border-fd-border bg-fd-background text-sm shadow-xs">
      <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-l-lg px-3 py-1.5 font-medium hover:bg-fd-accent">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy page"}
      </button>
      <button
        type="button"
        aria-label="More page actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-r-lg border-l border-fd-border px-2 hover:bg-fd-accent"
      >
        <CaretDown className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-fd-border bg-fd-popover p-1 shadow-lg">
          <a className={item} href={md} target="_blank" rel="noreferrer">
            <FileText className="size-4" /> View as Markdown
          </a>
          <a className={item} href={`https://chatgpt.com/?hints=search&q=${prompt}`} target="_blank" rel="noreferrer">
            <ArrowSquareOut className="size-4" /> Open in ChatGPT
          </a>
          <a className={item} href={`https://claude.ai/new?q=${prompt}`} target="_blank" rel="noreferrer">
            <ArrowSquareOut className="size-4" /> Open in Claude
          </a>
        </div>
      )}
    </div>
  );
}
