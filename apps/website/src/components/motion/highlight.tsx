"use client";

import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { motion, useReducedMotion, type Transition } from "motion/react";
import { cn } from "@modelstill/ui/lib/utils";

type HighlightState = { value: string | null; layoutId: string; transition?: Transition; className?: string };

const HighlightContext = createContext<HighlightState | null>(null);

export function Highlight({ value, transition, className, children }: { value: string | null; transition?: Transition; className?: string; children: ReactNode }) {
  const layoutId = useId();
  return <HighlightContext.Provider value={{ value, layoutId, transition, className }}>{children}</HighlightContext.Provider>;
}

export function HighlightItem({ value, className, children, ...props }: ComponentProps<"div"> & { value: string }) {
  const state = useContext(HighlightContext);
  const reduced = useReducedMotion() ?? false;
  const active = state !== null && state.value === value;
  return (
    <div data-slot="highlight-item" data-active={active || undefined} className={cn("relative", className)} {...props}>
      {active && (
        <motion.div
          aria-hidden="true"
          data-slot="motion-highlight"
          layoutId={state.layoutId}
          transition={reduced ? { duration: 0 } : state.transition}
          className={cn("pointer-events-none absolute", state.className)}
        />
      )}
      {children}
    </div>
  );
}
