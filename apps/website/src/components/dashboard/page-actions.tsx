"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Slot = { node: HTMLElement | null; setNode: (node: HTMLElement | null) => void };

const PageActionsContext = createContext<Slot | null>(null);
const CrumbBadgeContext = createContext<Slot | null>(null);

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [badge, setBadge] = useState<HTMLElement | null>(null);
  return (
    <PageActionsContext.Provider value={{ node, setNode }}>
      <CrumbBadgeContext.Provider value={{ node: badge, setNode: setBadge }}>{children}</CrumbBadgeContext.Provider>
    </PageActionsContext.Provider>
  );
}

export function PageActionsSlot({ className }: { className?: string }) {
  const slot = useContext(PageActionsContext);
  return <div ref={(node) => slot?.setNode(node)} data-slot="page-actions" className={className} />;
}

export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionsContext);
  if (!slot) return <div className="flex items-center gap-1.5">{children}</div>;
  if (!slot.node) return null;
  return createPortal(children, slot.node);
}

export function CrumbBadgeSlot({ className }: { className?: string }) {
  const slot = useContext(CrumbBadgeContext);
  return <span ref={(node) => slot?.setNode(node)} data-slot="crumb-badge" className={className} />;
}

export function CrumbBadge({ children }: { children: ReactNode }) {
  const slot = useContext(CrumbBadgeContext);
  if (!slot?.node) return null;
  return createPortal(children, slot.node);
}
