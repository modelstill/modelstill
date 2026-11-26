"use client";

import { useParams } from "next/navigation";

export function useSlug(): string {
  const params = useParams<{ slug: string }>();
  return decodeURIComponent(params?.slug ?? "");
}
