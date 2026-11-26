"use client";

import { useEffect, useState } from "react";
import { BookOpenTextIcon, FileCodeIcon, MagnifyingGlassIcon, PlugsConnectedIcon, ShieldCheckIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { AnnouncementDialog, type TerminalLine } from "@modelstill/ui/blocks/announcement-dialog";
import type { Task } from "@/lib/api";
import { SETUP_INTRO_KEY, showSetupIntro } from "@/lib/get-started";

export const SETUP_LINES: TerminalLine[] = [
  { key: "run", icon: TerminalWindowIcon, text: "modelstill setup --agent claude" },
  { key: "skill", icon: BookOpenTextIcon, text: "reading the ModelStill skill..." },
  { key: "calls", icon: MagnifyingGlassIcon, text: "finding your LLM calls..." },
  { key: "spec", icon: FileCodeIcon, text: "writing tasks/<task>/spec.yaml..." },
  { key: "record", icon: PlugsConnectedIcon, text: "wiring the LiteLLM recorder..." },
  { key: "gate", icon: ShieldCheckIcon, text: "pull-request gate added" },
];

export function SetupIntroDialog({ open, onOpenChange, onExplore }: { open: boolean; onOpenChange: (open: boolean) => void; onExplore: () => void }) {
  return (
    <AnnouncementDialog
      open={open}
      onOpenChange={onOpenChange}
      lines={SETUP_LINES}
      title="Set up with your coding agent"
      description="modelstill setup hands your agent one prompt. It finds your LLM calls, writes a task spec, wires recording and adds the gate, then stops for your review."
      action="Show me the steps"
      onAction={onExplore}
    />
  );
}

function dismissed(): boolean {
  try {
    return window.localStorage.getItem(SETUP_INTRO_KEY) === "1";
  } catch {
    return true;
  }
}

function remember() {
  try {
    window.localStorage.setItem(SETUP_INTRO_KEY, "1");
  } catch {
    return;
  }
}

export function FirstRunIntro({ tasks, onExplore }: { tasks: Task[] | null; onExplore: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (showSetupIntro(tasks, dismissed())) setOpen(true);
  }, [tasks]);
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) remember();
  };
  return (
    <SetupIntroDialog
      open={open}
      onOpenChange={close}
      onExplore={() => {
        close(false);
        onExplore();
      }}
    />
  );
}
