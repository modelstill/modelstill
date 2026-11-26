"use client";

import { useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircleIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { DURATION, EASE_OUT } from "@/lib/motion";

export type CopyButtonProps = Omit<ComponentProps<typeof Button>, "content" | "children" | "asChild"> & {
  content: string;
  label?: ReactNode;
  copiedLabel?: ReactNode;
  delay?: number;
  onCopyError?: (error: unknown) => void;
};

const ICON = { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.6 } };

export function CopyButton({ content, label, copiedLabel = "Copied", delay = 1600, onCopyError, onClick, type = "button", ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion() ?? false;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      onCopyError?.(error);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), delay);
  }

  return (
    <Button type={type} data-slot="copy-button" data-copied={copied || undefined} onClick={copy} {...props}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "copied" : "copy"}
          className="inline-flex"
          {...(reduced ? {} : ICON)}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        >
          {copied ? <CheckCircleIcon aria-hidden="true" weight="fill" className="text-status-ok" /> : <CopyIcon aria-hidden="true" />}
        </motion.span>
      </AnimatePresence>
      {label !== undefined && <span>{copied ? copiedLabel : label}</span>}
    </Button>
  );
}
