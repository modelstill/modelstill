"use client";

import { motion, useReducedMotion, type HTMLMotionProps, type TargetAndTransition, type Transition } from "motion/react";
import { Slot } from "radix-ui";

const MotionSlot = motion.create(Slot.Root) as unknown as typeof motion.div;

export type EnterProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "exit"> & {
  asChild?: boolean;
  delay?: number;
};

export function Enter({
  asChild = false,
  delay = 0,
  from,
  to,
  transition,
  ...props
}: EnterProps & { from: TargetAndTransition; to: TargetAndTransition; transition?: Transition }) {
  const reduced = useReducedMotion() ?? false;
  const Component = asChild ? MotionSlot : motion.div;
  return <Component initial={reduced ? false : from} animate={to} exit={from} transition={{ ...transition, delay: delay / 1000 }} {...props} />;
}
