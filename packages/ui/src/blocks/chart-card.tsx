import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import { cn } from "@modelstill/ui/lib/utils";

export type ChartCardProps = {
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ChartCard({ title, description, value, note, action, children, className }: ChartCardProps) {
  return (
    <Card data-slot="chart-card" className={cn("gap-4 py-5", className)}>
      <CardHeader className="px-5">
        <CardTitle className="text-[13.5px]">{title}</CardTitle>
        {value !== undefined && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[24px] leading-none font-medium tracking-[-0.01em] text-foreground tabular-nums">{value}</span>
            {note && <span className="text-xs text-muted-foreground">{note}</span>}
          </div>
        )}
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  );
}
