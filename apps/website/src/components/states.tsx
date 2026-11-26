"use client";

import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState, type LoadingVariant } from "@modelstill/ui/blocks/states";
import type { Resource } from "@/lib/use-api";

export { EmptyState, ErrorState, LoadingState };

function isEmpty(data: unknown): boolean {
  return data === null || data === undefined || (Array.isArray(data) && data.length === 0);
}

export function ResourceView<T>({
  resource,
  empty,
  emptyDescription,
  emptyState,
  loading = "table",
  children,
  isEmptyData = isEmpty,
}: {
  resource: Resource<T> & { reload: () => void };
  empty: ReactNode;
  emptyDescription?: ReactNode;
  emptyState?: ReactNode;
  loading?: LoadingVariant;
  children: (data: NonNullable<T>) => ReactNode;
  isEmptyData?: (data: T) => boolean;
}) {
  if (resource.status === "loading") return <LoadingState variant={loading} />;
  if (resource.status === "error") return <ErrorState error={resource.error} onRetry={resource.reload} />;
  if (isEmptyData(resource.data)) return emptyState ?? <EmptyState title={empty} description={emptyDescription} />;
  return <>{children(resource.data as NonNullable<T>)}</>;
}
