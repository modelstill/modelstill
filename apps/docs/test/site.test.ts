import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GITHUB_URL } from "../src/lib/site";

const layout = readFileSync(join(import.meta.dir, "..", "src", "app", "layout.tsx"), "utf8");

describe("site chrome", () => {
  test("the navbar links to the GitHub repository", () => {
    expect(GITHUB_URL).toBe("https://github.com/modelstill/modelstill");
    expect(layout).toContain("githubUrl={GITHUB_URL}");
  });

  test("the GitHub mark in the navbar is black", () => {
    const css = readFileSync(join(import.meta.dir, "..", "src", "app", "globals.css"), "utf8");
    expect(css).toContain('a[href="https://github.com/modelstill/modelstill"] { color: #000; }');
  });

  test("the site description leads with LLM evals, not distillation", () => {
    expect(layout).toMatch(/description:\s*\n?\s*"ModelStill documentation: an open-source LLM eval framework for CI/);
  });
});
