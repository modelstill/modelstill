"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { CreatedApiKey } from "@/lib/api";
import type { OnboardingGoal } from "@/lib/onboarding";

type OnboardingState = {
  createdKey: CreatedApiKey | null;
  setCreatedKey: (key: CreatedApiKey | null) => void;
  goal: OnboardingGoal;
  setGoal: (goal: OnboardingGoal) => void;
  lastStep: RefObject<number | null>;
};

const Context = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [goal, setGoal] = useState<OnboardingGoal>("extract");
  const lastStep = useRef<number | null>(null);
  const value = useMemo(() => ({ createdKey, setCreatedKey, goal, setGoal, lastStep }), [createdKey, goal]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOnboarding(): OnboardingState {
  const state = useContext(Context);
  if (!state) throw new Error("useOnboarding needs an OnboardingProvider");
  return state;
}

export function useStepMemory(): RefObject<number | null> | null {
  return useContext(Context)?.lastStep ?? null;
}
