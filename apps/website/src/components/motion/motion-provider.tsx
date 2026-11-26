"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { FADE } from "@/lib/motion";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={FADE}>
      {children}
    </MotionConfig>
  );
}
