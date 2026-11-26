import { cn } from "@modelstill/ui/lib/utils";
import { UiLink } from "./link";

export const PRODUCT_NAME = "ModelStill";

export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-slot="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <rect x="6" y="7" width="20" height="4" rx="2" fill="var(--brand-foreground)" />
      <rect x="10" y="14" width="12" height="4" rx="2" fill="var(--brand-foreground)" />
      <circle cx="16" cy="23.5" r="3.5" fill="var(--brand-foreground)" />
    </svg>
  );
}

export const BrandMark = LogoMark;

export function Logo({ size = 26, className, wordmarkClassName }: { size?: number; className?: string; wordmarkClassName?: string }) {
  return (
    <span data-slot="brand-logo" className={cn("inline-flex items-center gap-2.5 text-foreground", className)}>
      <LogoMark size={size} />
      <span className={cn("brand-wordmark leading-none", wordmarkClassName ?? "text-[20px]")}>{PRODUCT_NAME}</span>
    </span>
  );
}

export function BrandLockup({ href, compact = false, className }: { href: string; compact?: boolean; className?: string }) {
  return (
    <UiLink
      href={href}
      aria-label={`${PRODUCT_NAME} home`}
      data-slot="brand-lockup"
      className={cn("inline-flex items-center gap-2.5 rounded-md text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring", className)}
    >
      <LogoMark />
      {!compact && <span className="brand-wordmark text-[20px] leading-none group-data-[collapsible=icon]:hidden">{PRODUCT_NAME}</span>}
    </UiLink>
  );
}
