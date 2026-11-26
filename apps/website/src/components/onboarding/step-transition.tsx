"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Fade } from "@/components/motion/fade";
import { Slide } from "@/components/motion/slide";
import { FADE, RISE_PX, slideFrom, stepDirection } from "@/lib/motion";
import { useStepMemory } from "./onboarding-state";

export function StepTransition({ step, children }: { step: number; children: ReactNode }) {
  const memory = useStepMemory();
  const [previous] = useState(() => memory?.current ?? null);
  const direction = stepDirection(previous, step);

  useEffect(() => {
    if (memory) memory.current = step;
  }, [memory, step]);

  return (
    <Fade data-slot="step-transition" data-direction={direction} transition={FADE} className="w-full">
      <Slide
        direction={previous === null ? "up" : slideFrom(direction)}
        offset={previous === null ? RISE_PX : RISE_PX * 2}
        transition={FADE}
        className="w-full"
      >
        {children}
      </Slide>
    </Fade>
  );
}
