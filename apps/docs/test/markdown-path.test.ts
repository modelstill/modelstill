import { describe, expect, test } from "bun:test";
import { markdownParams, markdownPath, pageSlug } from "../src/lib/markdown-path.ts";

describe("markdown copies of pages", () => {
  test("every page has a file path that cannot clash with a folder of the same name", () => {
    expect(markdownPath("/")).toBe("/llms.mdx/index.md");
    expect(markdownPath("/api-reference")).toBe("/llms.mdx/api-reference.md");
    expect(markdownPath("/api-reference/eval-runs")).toBe("/llms.mdx/api-reference/eval-runs.md");
  });

  test("the route maps a file path back to the page it came from", () => {
    expect(pageSlug(["index.md"])).toEqual([]);
    expect(pageSlug(["api-reference.md"])).toEqual(["api-reference"]);
    expect(pageSlug(["api-reference", "eval-runs.md"])).toEqual(["api-reference", "eval-runs"]);
    expect(pageSlug(["api-reference"])).toBeNull();
    expect(pageSlug(undefined)).toBeNull();
  });

  test("static params cover the home page and nested pages", () => {
    expect(markdownParams([{ slug: [] }, { slug: ["guides", "ci-gate"] }])).toEqual([
      { slug: ["index.md"] },
      { slug: ["guides", "ci-gate.md"] },
    ]);
  });
});
