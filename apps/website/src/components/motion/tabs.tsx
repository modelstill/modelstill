"use client";

import { createContext, useContext, useId, useState, type ComponentProps } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Tabs as TabsRoot, TabsContent, TabsList, TabsTrigger as TabsTriggerBase } from "@modelstill/ui/components/tabs";
import { cn } from "@modelstill/ui/lib/utils";
import { SLIDE_SPRING } from "@/lib/motion";

type TabsState = { value: string | undefined; layoutId: string };

const TabsContext = createContext<TabsState | null>(null);

export function Tabs({ value, defaultValue, onValueChange, ...props }: ComponentProps<typeof TabsRoot>) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const current = value ?? uncontrolled;
  const layoutId = useId();

  function change(next: string) {
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  }

  return (
    <TabsContext.Provider value={{ value: current, layoutId }}>
      <TabsRoot value={current} onValueChange={change} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsTrigger({ value, className, children, ...props }: ComponentProps<typeof TabsTriggerBase>) {
  const state = useContext(TabsContext);
  const reduced = useReducedMotion() ?? false;
  const active = state !== null && state.value === value;
  return (
    <TabsTriggerBase
      value={value}
      className={cn(
        "transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent",
        className,
      )}
      {...props}
    >
      {active && (
        <motion.span
          aria-hidden="true"
          data-slot="tabs-indicator"
          layoutId={state.layoutId}
          transition={reduced ? { duration: 0 } : SLIDE_SPRING}
          className="pointer-events-none absolute -inset-px rounded-md bg-background shadow-sm dark:border dark:border-input dark:bg-input/30"
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </TabsTriggerBase>
  );
}

export { TabsContent, TabsList };
