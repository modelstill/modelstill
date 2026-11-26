import type { Transition } from "motion/react";

export const EASE_OUT: [number, number, number, number] = [0.32, 0.72, 0, 1];

export const DURATION = { fast: 0.15, base: 0.2, slow: 0.25 } as const;

export const FADE: Transition = { duration: DURATION.base, ease: EASE_OUT };

export const SLIDE_SPRING: Transition = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 };

export const RISE_PX = 6;

export const SHAKE_X = [0, -6, 6, -4, 4, 0];

export type Direction = 1 | -1;

export function stepDirection(previous: number | null, next: number): Direction {
  return previous !== null && next < previous ? -1 : 1;
}

export function slideFrom(direction: Direction): "left" | "right" {
  return direction === 1 ? "left" : "right";
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function fixedFormat(digits: number): (value: number) => string {
  return (value) => value.toFixed(digits);
}
