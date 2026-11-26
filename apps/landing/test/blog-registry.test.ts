import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GET as blogLlms } from "../src/app/blog/llms.txt/route.ts";
import robots from "../src/app/robots.ts";
import sitemap from "../src/app/sitemap.ts";
import { POST_BODIES } from "../src/lib/blog/bodies/index.ts";
import { POSTS, POSTS_PER_PAGE } from "../src/lib/blog/posts.ts";
import { docsLinks, registryProblems } from "../src/lib/blog/validate.ts";
import { FOOTER, NAV, SITE_URL } from "../src/lib/content.ts";

const DOCS = join(import.meta.dir, "..", "..", "docs", "content", "docs");

function docsPageExists(path: string): boolean {
  return existsSync(join(DOCS, `${path}.mdx`)) || existsSync(join(DOCS, path, "index.mdx"));
}

describe("blog registry", () => {
  test("has the seed posts", () => {
    expect(POSTS.length).toBeGreaterThanOrEqual(4);
  });

  test("passes every registry rule against the real docs", () => {
    expect(registryProblems(POSTS, POST_BODIES, docsPageExists)).toEqual([]);
  });

  test("every post links to at least one docs page", () => {
    const bare = POSTS.filter((post) => docsLinks(POST_BODIES[post.slug]).length === 0).map((post) => post.slug);
    expect(bare).toEqual([]);
  });

  test("posts are listed newest first", () => {
    const dates = POSTS.map((post) => post.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("pages hold nine posts, as the reference blog does", () => {
    expect(POSTS_PER_PAGE).toBe(9);
  });
});

describe("blog discovery", () => {
  test("the sitemap lists the home page, the blog and every post", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/blog`);
    expect(urls).toContain(`${SITE_URL}/blog/all`);
    for (const post of POSTS) expect(urls).toContain(`${SITE_URL}/blog/${post.slug}`);
  });

  test("robots allows crawling and points at the sitemap", () => {
    const rules = robots();
    expect(rules.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(rules.rules).toEqual({ userAgent: "*", allow: "/" });
  });

  test("blog/llms.txt lists every post with its link", async () => {
    const text = await blogLlms().text();
    expect(text.startsWith("# ModelStill blog")).toBe(true);
    for (const post of POSTS) expect(text).toContain(`[${post.title}](${SITE_URL}/blog/${post.slug})`);
  });

  test("the header and the footer link to the blog", () => {
    expect(NAV.some((item) => item.href === "/blog")).toBe(true);
    const resources = FOOTER.columns.find((column) => column.title === "Resources")!;
    expect(resources.links.some((link) => link.label === "Blog" && link.path === "/blog" && link.site === true)).toBe(true);
  });
});
