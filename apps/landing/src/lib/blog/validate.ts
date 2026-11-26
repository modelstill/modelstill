import { isValidElement, type ReactNode } from "react";
import type { Post } from "./types";

export const MAX_DESCRIPTION = 160;

export function docsLinks(node: ReactNode): string[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(docsLinks);
  if (!isValidElement(node)) return [];
  const props = node.props as { doc?: unknown; children?: ReactNode };
  const own = typeof props.doc === "string" ? [props.doc.split("#")[0]!] : [];
  return [...own, ...docsLinks(props.children)];
}

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function postProblems(post: Post, seen: Set<string>, body: ReactNode, docsPageExists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) problems.push("slug is not lowercase-kebab-case");
  if (seen.has(post.slug)) problems.push("duplicate slug");
  if (!isRealDate(post.date)) problems.push(`date ${post.date} is not a real YYYY-MM-DD date`);
  if (post.description.trim() === "") problems.push("description is empty");
  if (post.description.length > MAX_DESCRIPTION) problems.push(`description is ${post.description.length} characters, over ${MAX_DESCRIPTION}`);
  if (post.tags.length === 0) problems.push("has no tags");
  if (body === undefined) problems.push("has no body");
  for (const path of docsLinks(body)) if (!docsPageExists(path)) problems.push(`docs link ${path} has no page`);
  return problems.map((problem) => `${post.slug}: ${problem}`);
}

export function registryProblems(posts: readonly Post[], bodies: Record<string, ReactNode>, docsPageExists: (path: string) => boolean): string[] {
  const seen = new Set<string>();
  return posts.flatMap((post) => {
    const problems = postProblems(post, seen, bodies[post.slug], docsPageExists);
    seen.add(post.slug);
    return problems;
  });
}
