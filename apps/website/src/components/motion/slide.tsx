"use client";

import { Enter, type EnterProps } from "./enter";

export type SlideDirection = "up" | "down" | "left" | "right";

export type SlideProps = EnterProps & { direction?: SlideDirection; offset?: number };

const START: Record<SlideDirection, (offset: number) => { x: number } | { y: number }> = {
  up: (offset) => ({ y: offset }),
  down: (offset) => ({ y: -offset }),
  left: (offset) => ({ x: offset }),
  right: (offset) => ({ x: -offset }),
};

export function Slide({ direction = "up", offset = 8, ...props }: SlideProps) {
  return <Enter from={START[direction](offset)} to={{ x: 0, y: 0 }} {...props} />;
}
