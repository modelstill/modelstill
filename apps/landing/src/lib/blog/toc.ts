import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { treeText } from "./reading-time";

export type TocItem = { id: string; text: string };

export function headingId(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function topLevel(node: ReactNode): ReactNode {
  return isValidElement(node) ? (node.props as { children?: ReactNode }).children : node;
}

export function tableOfContents(node: ReactNode): { items: TocItem[]; body: ReactNode } {
  const items: TocItem[] = [];
  const seen = new Set<string>();
  const body = Children.map(topLevel(node), (child) => {
    if (!isValidElement(child) || child.type !== "h2") return child;
    const text = treeText((child.props as { children?: ReactNode }).children).replace(/\s+/g, " ").trim();
    const base = headingId(text);
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    items.push({ id, text });
    return cloneElement(child as ReactElement<{ id?: string }>, { id });
  });
  return { items, body };
}
