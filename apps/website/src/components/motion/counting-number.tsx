"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps, type ValueAnimationTransition } from "motion/react";
import { EASE_OUT } from "@/lib/motion";

const COUNT: ValueAnimationTransition<number> = { duration: 0.45, ease: EASE_OUT };

export type CountingNumberProps = Omit<HTMLMotionProps<"span">, "children"> & {
  number: number;
  from?: number;
  format: (value: number) => string;
  transition?: ValueAnimationTransition<number>;
};

export function CountingNumber({ number, from = 0, format, transition = COUNT, ...props }: CountingNumberProps) {
  const reduced = useReducedMotion() ?? false;
  const value = useMotionValue(reduced ? number : from);
  const text = useTransform(value, (latest) => format(latest));

  useEffect(() => {
    if (reduced) {
      value.jump(number);
      return;
    }
    const controls = animate(value, number, transition);
    return () => controls.stop();
  }, [number, reduced, transition, value]);

  return (
    <motion.span data-slot="counting-number" {...props}>
      {text}
    </motion.span>
  );
}
