"use client";

import { Enter, type EnterProps } from "./enter";

export type ZoomProps = EnterProps & { initialScale?: number };

export function Zoom({ initialScale = 0.5, ...props }: ZoomProps) {
  return <Enter from={{ opacity: 0, scale: initialScale }} to={{ opacity: 1, scale: 1 }} {...props} />;
}
