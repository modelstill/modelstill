import type { ComponentType, ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";
import { UiLink } from "./link";

type Icon = ComponentType<{ className?: string; weight?: "regular" | "bold" | "fill" | "duotone" }>;

export type FeatureGradient = "aurora" | "tide" | "dawn" | "mist";

export function TileChip({ icon: IconComponent, children, offset = 0, className }: { icon?: Icon; children: ReactNode; offset?: number; className?: string }) {
  return (
    <span
      className={cn("flex h-8 w-fit max-w-full items-center gap-2 rounded-lg bg-card/95 px-2.5 text-[12px] text-foreground shadow-[0_1px_3px_rgb(16_16_24/0.12)]", className)}
      style={{ marginLeft: offset }}
    >
      {IconComponent && <IconComponent weight="duotone" className="size-4 shrink-0 text-brand" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function TileIcon({ icon: IconComponent }: { icon: Icon }) {
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-card text-brand shadow-[0_1px_3px_rgb(16_16_24/0.14)]">
      <IconComponent weight="duotone" className="size-6" />
    </span>
  );
}

export type FeatureRowProps = { gradient: FeatureGradient; tile: ReactNode; title: ReactNode; description: ReactNode; href?: string; status?: ReactNode };

export function FeatureRow({ gradient, tile, title, description, href, status }: FeatureRowProps) {
  const body = (
    <div
      data-slot="feature-row"
      className="flex items-center gap-6 rounded-[26px] border border-border bg-card p-1.5 pr-6 shadow-[0_1px_2px_rgb(16_16_24/0.04)] transition-colors hover:border-foreground/15"
    >
      <div aria-hidden="true" className={cn("flex h-[100px] w-[156px] shrink-0 flex-col justify-center gap-1.5 overflow-hidden rounded-[20px] px-4 sm:w-[180px]", `ms-gradient-${gradient}`)}>
        {tile}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="type-title text-foreground">{title}</h3>
        <p className="text-[14.5px] leading-5 text-muted-foreground">{description}</p>
      </div>
      {status && <div className="hidden shrink-0 sm:block">{status}</div>}
    </div>
  );
  return href ? (
    <UiLink href={href} className="block rounded-[26px] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </UiLink>
  ) : (
    body
  );
}
