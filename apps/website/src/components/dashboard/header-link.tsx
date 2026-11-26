"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { Button } from "@modelstill/ui/components/button";
import { cn } from "@modelstill/ui/lib/utils";

export const HEADER_BUTTON = "h-8 gap-1.5 rounded-md px-2.5 text-sm font-medium [&_svg]:size-4";

export function HeaderLink({
  href,
  icon: Icon,
  children,
  primary = false,
}: {
  href: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Button asChild size="sm" variant={primary ? "default" : "ghost"} className={cn(HEADER_BUTTON, !primary && "text-muted-foreground hover:text-foreground")}>
      <Link href={href} aria-label={typeof children === "string" ? children : undefined}>
        {Icon && <Icon aria-hidden="true" />}
        <span className={cn(!primary && Icon && "hidden md:inline")}>{children}</span>
      </Link>
    </Button>
  );
}
