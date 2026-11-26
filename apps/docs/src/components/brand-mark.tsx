export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <rect x="6" y="7" width="20" height="4" rx="2" fill="var(--brand-foreground)" />
      <rect x="10" y="14" width="12" height="4" rx="2" fill="var(--brand-foreground)" />
      <circle cx="16" cy="23.5" r="3.5" fill="var(--brand-foreground)" />
    </svg>
  );
}
