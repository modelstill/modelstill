import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const APP_ROOT = join(import.meta.dir, "..");
export const CONTENT = join(APP_ROOT, "content", "docs");
export const PUBLIC = join(APP_ROOT, "public");

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, keep);
    return keep(entry) ? [full] : [];
  });
}

export function mdxFiles(): string[] {
  return walk(CONTENT, (name) => name.endsWith(".mdx"));
}

export function metaFiles(): string[] {
  return walk(CONTENT, (name) => name === "meta.json");
}

export function read(file: string): string {
  return readFileSync(file, "utf8");
}

export function relativeToContent(file: string): string {
  return relative(CONTENT, file);
}

export function pageUrl(file: string): string {
  const rel = relativeToContent(file).replace(/\.mdx$/, "");
  if (rel === "index") return "/";
  return `/${rel.replace(/\/index$/, "")}`;
}

export function frontmatter(file: string): Record<string, string> {
  const match = read(file).match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]!
      .split("\n")
      .map((line) => line.match(/^([A-Za-z_]+):\s*(.*)$/))
      .filter((found): found is RegExpMatchArray => found !== null)
      .map((found) => [found[1]!, found[2]!.trim()]),
  );
}
