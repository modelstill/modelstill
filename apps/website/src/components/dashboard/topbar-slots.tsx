"use client";

import type { ReactNode } from "react";

export function FrameBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-strong px-3">
      {left}
      <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
    </header>
  );
}
