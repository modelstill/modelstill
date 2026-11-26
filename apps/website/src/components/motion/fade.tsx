"use client";

import { Enter, type EnterProps } from "./enter";

export type FadeProps = EnterProps & { initialOpacity?: number };

export function Fade({ initialOpacity = 0, ...props }: FadeProps) {
  return <Enter from={{ opacity: initialOpacity }} to={{ opacity: 1 }} {...props} />;
}
