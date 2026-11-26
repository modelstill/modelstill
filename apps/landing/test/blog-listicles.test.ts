import { describe, expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Table } from "../src/components/blog/body-kit.tsx";
import { POST_BODIES } from "../src/lib/blog/bodies/index.ts";
import { POSTS } from "../src/lib/blog/posts.ts";

const LISTICLES = ["best-open-source-llm-eval-frameworks", "llm-observability-tools-compared", "langfuse-alternatives", "braintrust-alternatives", "ai-red-teaming-tools"];

const DISCLOSURE = "We build ModelStill, so we've marked where it fits and where it doesn't.";

function text(slug: string): string {
  const html = renderToStaticMarkup(createElement(Fragment, null, POST_BODIES[slug]));
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("tool comparison posts", () => {
  test("are registered with a body", () => {
    const slugs = POSTS.map((post) => post.slug);
    for (const slug of LISTICLES) {
      expect(slugs).toContain(slug);
      expect(POST_BODIES[slug]).toBeDefined();
    }
  });

  test("disclose that we build ModelStill", () => {
    const missing = LISTICLES.filter((slug) => !text(slug).includes(DISCLOSURE));
    expect(missing).toEqual([]);
  });

  test("date every star count", () => {
    const undated = LISTICLES.filter((slug) => /stars/i.test(text(slug)) && !text(slug).includes("as of 26 Nov 2026"));
    expect(undated).toEqual([]);
  });

  test("leave the earlier posts' dates alone", () => {
    const dates = Object.fromEntries(POSTS.map((post) => [post.slug, post.date]));
    expect(dates["small-model-gate-said-no"]).toBe("2026-11-26");
    expect(dates["llm-as-a-judge-check-against-people"]).toBe("2026-11-25");
    expect(dates["golden-dataset-from-production-traces"]).toBe("2026-11-24");
    expect(dates["llm-eval-framework-release-decision"]).toBe("2026-11-23");
  });
});

describe("post table", () => {
  test("wraps the table in a scroll container with a header row", () => {
    const html = renderToStaticMarkup(createElement(Table, { head: ["Tool", "Licence"], rows: [["garak", "Apache-2.0"]] }));
    expect(html.startsWith('<div class="post-table">')).toBe(true);
    expect(html).toContain("<th scope=\"col\">Tool</th>");
    expect(html).toContain("<td>Apache-2.0</td>");
  });
});
