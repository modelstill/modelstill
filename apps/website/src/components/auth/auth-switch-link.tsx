"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export function AuthSwitchLink({ to, children }: { to: "/login" | "/signup"; children: ReactNode }) {
  const query = useSearchParams()?.toString();
  return (
    <Link href={query ? `${to}?${query}` : to} className="font-medium text-link hover:text-link/80">
      {children}
    </Link>
  );
}
