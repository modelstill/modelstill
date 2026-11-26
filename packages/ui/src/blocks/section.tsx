import { useId, type ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";

export type SectionProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, description, actions, children, className }: SectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot="section" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={headingId} className="type-label text-muted-foreground">
            {title}
          </h2>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 text-sm">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10", className)}>{children}</div>;
}
