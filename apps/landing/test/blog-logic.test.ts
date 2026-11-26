import { describe, expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { blogPostingLd } from "../src/lib/blog/ld.ts";
import { pageCount, pageHref, pagePosts, pageWindow } from "../src/lib/blog/pagination.ts";
import { readingMinutes, treeText, wordCount } from "../src/lib/blog/reading-time.ts";
import { relatedPosts } from "../src/lib/blog/related.ts";
import { headingId, tableOfContents } from "../src/lib/blog/toc.ts";
import { docsLinks, registryProblems } from "../src/lib/blog/validate.ts";
import type { Post } from "../src/lib/blog/types.ts";

function post(slug: string, date: string, tags: string[], extra: Partial<Post> = {}): Post {
  return { slug, title: `Title ${slug}`, description: `About ${slug}.`, date, tags, art: { tone: "leaf", motif: "bars" }, ...extra };
}

describe("reading time", () => {
  test("counts words separated by any whitespace", () => {
    expect(wordCount("  one two\nthree\tfour  ")).toBe(4);
    expect(wordCount("")).toBe(0);
  });

  test("rounds up at 230 words a minute and never says zero", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes(Array(230).fill("w").join(" "))).toBe(1);
    expect(readingMinutes(Array(231).fill("w").join(" "))).toBe(2);
  });

  test("reads the text of a React tree, element children included", () => {
    const tree = createElement(Fragment, null, createElement("h2", null, "Two words"), createElement("p", null, "and ", createElement("code", null, "three"), " more"), null, false, 7);
    expect(wordCount(treeText(tree))).toBe(6);
  });
});

describe("related posts", () => {
  const a = post("a", "2026-11-26", ["Judges", "Statistics"]);
  const b = post("b", "2026-11-20", ["Judges", "Statistics"]);
  const c = post("c", "2026-11-25", ["Statistics"]);
  const d = post("d", "2026-11-24", ["Datasets"]);
  const e = post("e", "2026-11-23", ["Judges"]);

  test("ranks by the number of shared tags, then newest first", () => {
    expect(relatedPosts(a, [a, b, c, d, e], 3).map((p) => p.slug)).toEqual(["b", "c", "e"]);
  });

  test("never lists the post itself and pads with the newest other posts", () => {
    expect(relatedPosts(d, [a, b, c, d, e], 3).map((p) => p.slug)).toEqual(["a", "c", "e"]);
  });

  test("returns fewer only when there are not enough posts", () => {
    expect(relatedPosts(a, [a, d], 3).map((p) => p.slug)).toEqual(["d"]);
  });

  test("breaks a tie on date by slug", () => {
    const x = post("x", "2026-11-01", ["Judges"]);
    const y = post("y", "2026-11-01", ["Judges"]);
    expect(relatedPosts(e, [y, x, e], 2).map((p) => p.slug)).toEqual(["x", "y"]);
  });
});

describe("pagination", () => {
  test("counts pages with at least one page", () => {
    expect(pageCount(0, 9)).toBe(1);
    expect(pageCount(9, 9)).toBe(1);
    expect(pageCount(10, 9)).toBe(2);
  });

  test("slices a page of posts", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(pagePosts(items, 1, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pagePosts(items, 3, 9)).toEqual([18, 19]);
  });

  test("the first page lives at /blog and the rest under /blog/page", () => {
    expect(pageHref(1)).toBe("/blog");
    expect(pageHref(4)).toBe("/blog/page/4");
  });

  test("shows first, last and two either side, with a gap only for hidden pages", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, "gap", 10]);
    expect(pageWindow(6, 12)).toEqual([1, "gap", 4, 5, 6, 7, 8, "gap", 12]);
    expect(pageWindow(5, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, "gap", 10]);
  });
});

describe("table of contents", () => {
  test("makes a URL-safe id from a heading", () => {
    expect(headingId("Pick a judge from another family!")).toBe("pick-a-judge-from-another-family");
    expect(headingId("  ?? ")).toBe("section");
  });

  test("lists the h2 headings of a body and gives each a unique id", () => {
    const body = createElement(
      Fragment,
      null,
      createElement("p", null, "Intro"),
      createElement("h2", null, "What it measures"),
      createElement("h3", null, "Not listed"),
      createElement("h2", null, "What it ", createElement("em", null, "measures")),
    );
    const { items, body: withIds } = tableOfContents(body);
    expect(items).toEqual([
      { id: "what-it-measures", text: "What it measures" },
      { id: "what-it-measures-2", text: "What it measures" },
    ]);
    const ids = (withIds as unknown[]).flatMap((child) => {
      const props = (child as { props?: { id?: string } }).props;
      return props?.id ? [props.id] : [];
    });
    expect(ids).toEqual(["what-it-measures", "what-it-measures-2"]);
  });
});

describe("article JSON-LD", () => {
  test("describes a post as a BlogPosting on the site", () => {
    const ld = blogPostingLd(post("gate", "2026-11-26", ["Release gate"]), "https://modelstill.com");
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "Title gate",
      description: "About gate.",
      datePublished: "2026-11-26",
      dateModified: "2026-11-26",
      url: "https://modelstill.com/blog/gate",
      mainEntityOfPage: "https://modelstill.com/blog/gate",
      image: "https://modelstill.com/blog/gate/opengraph-image",
      keywords: "Release gate",
      author: { "@type": "Organization", name: "ModelStill", url: "https://modelstill.com" },
      publisher: { "@type": "Organization", name: "ModelStill", url: "https://modelstill.com" },
    });
  });
});

describe("registry validation", () => {
  const exists = (path: string) => ["/quickstart", "/guides/llm-as-a-judge"].includes(path);
  const body = (doc: string) => createElement("p", null, createElement("a", { doc }, "docs"));

  test("collects docs links from a body, without anchors", () => {
    const tree = createElement(Fragment, null, body("/quickstart"), createElement("div", null, body("/guides/llm-as-a-judge#check-it")));
    expect(docsLinks(tree)).toEqual(["/quickstart", "/guides/llm-as-a-judge"]);
  });

  test("a clean registry has no problems", () => {
    expect(registryProblems([post("a", "2026-11-26", ["Judges"])], { a: body("/quickstart") }, exists)).toEqual([]);
  });

  test("reports every broken rule", () => {
    const long = "x".repeat(161);
    const problems = registryProblems(
      [
        post("a", "2026-11-26", ["Judges"]),
        post("a", "2026-13-01", [], { description: long }),
        post("Bad Slug", "2026-11-01", ["Judges"], { description: "" }),
      ],
      { a: body("/missing") },
      exists,
    );
    expect(problems).toEqual([
      "a: docs link /missing has no page",
      "a: duplicate slug",
      "a: date 2026-13-01 is not a real YYYY-MM-DD date",
      "a: description is 161 characters, over 160",
      "a: has no tags",
      "a: docs link /missing has no page",
      "Bad Slug: slug is not lowercase-kebab-case",
      "Bad Slug: description is empty",
      "Bad Slug: has no body",
    ]);
  });
});
