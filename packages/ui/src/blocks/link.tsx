"use client";

import { createContext, useContext, type ComponentProps, type ComponentType, type ReactNode } from "react";

export type LinkComponent = ComponentType<ComponentProps<"a"> & { href: string }>;

function PlainLink(props: ComponentProps<"a"> & { href: string }) {
  return <a {...props} />;
}

const LinkContext = createContext<LinkComponent>(PlainLink);

export function LinkProvider({ component, children }: { component: LinkComponent; children: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

export function useLinkComponent(): LinkComponent {
  return useContext(LinkContext);
}

export function UiLink(props: ComponentProps<"a"> & { href: string }) {
  const Component = useLinkComponent();
  return <Component {...props} />;
}
