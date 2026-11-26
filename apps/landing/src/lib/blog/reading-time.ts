import { isValidElement, type ReactNode } from "react";

export const WORDS_PER_MINUTE = 230;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(text: string): number {
  return Math.max(1, Math.ceil(wordCount(text) / WORDS_PER_MINUTE));
}

export function treeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return `${node} `;
  if (Array.isArray(node)) return node.map(treeText).join("");
  if (isValidElement(node)) return treeText((node.props as { children?: ReactNode }).children);
  return "";
}
