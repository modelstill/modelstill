"use client";

import Link from "next/link";
import { BookOpenIcon, CodeIcon, KeyboardIcon, PlugsConnectedIcon, QuestionIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@modelstill/ui/components/dropdown-menu";
import { Kbd } from "@modelstill/ui/components/kbd";
import { apiBaseUrl } from "@/lib/api";
import { DOCS_URL } from "@/lib/links";
import { CONNECT_HREF } from "@/lib/nav";

const MENU_ITEM = "cursor-pointer gap-3 px-2 py-1.5 text-[13px]";

export function HelpMenu({ onShortcuts, className, side = "top" }: { onShortcuts: () => void; className?: string; side?: "top" | "right" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Help" className={className}>
          <QuestionIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={8} className="w-[220px] bg-popover p-1.5">
        <DropdownMenuItem asChild className={MENU_ITEM}>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            <BookOpenIcon className="size-4 text-muted-foreground" />
            Docs
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={MENU_ITEM}>
          <a href={`${apiBaseUrl()}/openapi.json`} target="_blank" rel="noreferrer">
            <CodeIcon className="size-4 text-muted-foreground" />
            OpenAPI spec
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={MENU_ITEM}>
          <Link href={CONNECT_HREF}>
            <PlugsConnectedIcon className="size-4 text-muted-foreground" />
            Connect via MCP
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onShortcuts} className={MENU_ITEM}>
          <KeyboardIcon className="size-4 text-muted-foreground" />
          Keyboard shortcuts
          <Kbd className="ml-auto">?</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
