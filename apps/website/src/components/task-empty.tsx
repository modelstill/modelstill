"use client";

import { Fragment, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { BookOpenIcon, HourglassMediumIcon } from "@phosphor-icons/react";
import { cn } from "@modelstill/ui/lib/utils";
import { CopyButton } from "@/components/motion/copy-button";
import type { EmptyPage } from "@/lib/empty-states";
import { DOCS_URL } from "@/lib/links";

export function EmptyCommand({ command }: { command: string }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3 text-left">
      <span aria-hidden="true" className="pt-1 font-mono text-xs text-muted-foreground select-none">
        $
      </span>
      <code data-testid="empty-command" className="min-w-0 flex-1 pt-1 font-mono text-xs leading-5 text-foreground">
        {command.split(" ").map((token, index) => (
          <Fragment key={index}>
            {index > 0 && " "}
            <span className="whitespace-nowrap">{token}</span>
          </Fragment>
        ))}
      </code>
      <CopyButton content={command} variant="ghost" size="icon-sm" aria-label="Copy command" className="shrink-0 text-muted-foreground" />
    </div>
  );
}

export type UnlockTile = { label: string; description: string; href?: string; icon: ComponentType<{ className?: string }> };

export function UnlockTiles({ heading, tiles }: { heading: string; tiles: UnlockTile[] }) {
  return (
    <div className="border-t border-border pt-4">
      <p className="text-[12px] text-muted-foreground">{heading}</p>
      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                <tile.icon className="size-3.5 text-muted-foreground" />
                {tile.label}
              </span>
              <span className="mt-1 block text-[12px] leading-4 text-muted-foreground">{tile.description}</span>
            </>
          );
          return (
            <li key={tile.label}>
              {tile.href ? (
                <Link href={tile.href} className="block rounded-md hover:[&>span:first-child]:text-primary">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TaskEmptyState({ page, children, unlocks, className }: { page: EmptyPage; children?: ReactNode; unlocks?: ReactNode; className?: string }) {
  return (
    <div data-testid="task-empty" data-page={page.key} className={cn("flex w-full justify-center px-2 py-8", className)}>
      <div className="flex w-full max-w-[608px] flex-col gap-6">
        <div className="flex flex-col items-start gap-3">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-wash pr-3 pl-2 text-[13px] font-medium text-brand-text">
            <HourglassMediumIcon aria-hidden="true" className="size-4" />
            {page.title}
          </span>
          <p data-testid="empty-shows" className="text-[14px] leading-6 text-foreground/85">
            {page.shows}{" "}
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <BookOpenIcon aria-hidden="true" className="size-3.5" />
              Read the docs
            </a>
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="type-title text-foreground">Fill it from your repository</h2>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-5">
            <p className="text-[12.5px] text-muted-foreground">Run this from the repository root. The page updates as soon as the API has the data.</p>
            <EmptyCommand command={page.command} />
          </div>
        </div>
        {unlocks}
        {children && <div className="w-full">{children}</div>}
      </div>
    </div>
  );
}
