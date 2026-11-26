import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config.mjs";
import { PUBLIC, mdxFiles, pageUrl, read, relativeToContent } from "./content.ts";

const MARKDOWN_LINK = /\]\((\/[^)\s#?]*)[^)]*\)/g;
const HREF = /href="(\/[^"#?]*)[^"]*"/g;

type Redirect = { source: string };

function redirectMatches(source: string, url: string): boolean {
  const wildcard = source.indexOf("/:path*");
  if (wildcard === -1) return source === url;
  const prefix = source.slice(0, wildcard);
  return url === prefix || url.startsWith(`${prefix}/`);
}

describe("internal links in the docs", () => {
  test("every root-relative link resolves to a page, a public file or a redirect", async () => {
    const files = mdxFiles();
    const pages = new Set(files.map(pageUrl));
    const redirects = (((await nextConfig.redirects?.()) ?? []) as Redirect[]).map((entry) => entry.source);
    const broken: string[] = [];
    for (const file of files) {
      const text = read(file);
      for (const [, target] of [...text.matchAll(MARKDOWN_LINK), ...text.matchAll(HREF)]) {
        const url = target!.length > 1 ? target!.replace(/\/$/, "") : target!;
        const resolves =
          pages.has(url) || existsSync(join(PUBLIC, url)) || redirects.some((source) => redirectMatches(source, url));
        if (!resolves) broken.push(`${relativeToContent(file)} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("every page listed in a meta.json exists", () => {
    const pages = new Set(mdxFiles().map(pageUrl));
    expect(pages.has("/")).toBe(true);
    expect(pages.has("/quickstart")).toBe(true);
    expect(pages.has("/authentication")).toBe(true);
  });
});
