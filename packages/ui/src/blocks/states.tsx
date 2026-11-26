"use client";

import type { ComponentType, ReactNode } from "react";
import { ArrowClockwiseIcon, TrayIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@modelstill/ui/components/alert";
import { Button } from "@modelstill/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@modelstill/ui/components/empty";
import { Skeleton } from "@modelstill/ui/components/skeleton";
import { cn } from "@modelstill/ui/lib/utils";

export type LoadingVariant = "table" | "cards" | "chart";

export function LoadingState({ rows = 4, variant = "table", className }: { rows?: number; variant?: LoadingVariant; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={cn("flex flex-col gap-2", className)}>
      {variant === "cards" && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-[78px]" />
          ))}
        </div>
      )}
      {variant === "chart" && <Skeleton className="h-56" />}
      {variant === "table" && (
        <div className="flex flex-col gap-px overflow-hidden rounded-lg border">
          <Skeleton className="h-8 rounded-none" />
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-8 rounded-none opacity-60" />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  error,
  title = "Could not load this data",
  onRetry,
  className,
}: {
  error: Error | string;
  title?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={className}>
      <WarningCircleIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words">{typeof error === "string" ? error : error.message}</span>
        {onRetry && (
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            <ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = TrayIcon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
