import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CTA, DOCS_URL, EVALUATE, FOOTER, GITHUB, NAV, SWAP, TASKS, WORKS_WITH } from "../src/lib/content.ts";

const SRC = join(import.meta.dir, "..", "src");
const DOCS = join(import.meta.dir, "..", "..", "docs", "content", "docs");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

const text = sources(SRC)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

describe("landing content", () => {
  test("every link goes to a landing section, the blog or the docs", () => {
    for (const link of [...NAV, CTA]) {
      expect(link.href.startsWith("/#") || link.href === "/blog" || link.href.startsWith(DOCS_URL)).toBe(true);
    }
  });

  test("links to the GitHub repository from the header", () => {
    expect(GITHUB).toEqual({ label: "ModelStill on GitHub", href: "https://github.com/modelstill/modelstill" });
    const header = readFileSync(join(SRC, "components", "header.tsx"), "utf8");
    expect(header).toContain("GithubLogoIcon");
    expect(header).toContain("GITHUB.href");
    expect(header).toContain("aria-label={GITHUB.label}");
    expect(header).toMatch(/<GithubLogoIcon size=\{18\} weight="fill" className="text-black" \/>/);
  });

  test("in-page links point at sections that exist", () => {
    const sections = new Set<string>([EVALUATE.id, SWAP.id]);
    for (const link of NAV.filter((item) => item.href.startsWith("/#"))) {
      expect(sections.has(link.href.slice(2))).toBe(true);
    }
  });

  test("makes no customer or endorsement claims", () => {
    expect(text).not.toMatch(/trusted by|hundreds of|customers love|as seen in/i);
  });

  test("uses no other company's brand as its own", () => {
    expect(text).not.toMatch(new RegExp(["las", "so"].join(""), "i"));
    expect(text).not.toMatch(/apple pay|google pay|mastercard|klarna|paypal|stripe|visa/i);
  });

  test("names only tools the product integrates with", () => {
    expect(WORKS_WITH.map((tool) => tool.name)).toEqual(["Langfuse", "Braintrust", "OpenTelemetry", "LiteLLM", "pytest", "GitHub Actions"]);
  });

  test("every tool shows its own logo file", () => {
    const missing = WORKS_WITH.filter((tool) => !existsSync(join(import.meta.dir, "..", "public", tool.logo))).map((tool) => tool.name);
    expect(missing).toEqual([]);
    expect(new Set(WORKS_WITH.map((tool) => tool.logo)).size).toBe(WORKS_WITH.length);
  });

  test("every footer docs link is a page that exists in the docs", () => {
    const missing = FOOTER.columns
      .flatMap((column) => column.links)
      .filter((link) => !link.site)
      .filter((link) => !existsSync(join(DOCS, `${link.path}.mdx`)) && !existsSync(join(DOCS, link.path, "index.mdx")))
      .map((link) => link.path);
    expect(missing).toEqual([]);
  });

  test("every footer site link is a page that exists on the landing", () => {
    const missing = FOOTER.columns
      .flatMap((column) => column.links)
      .filter((link) => link.site)
      .filter((link) => !existsSync(join(SRC, "app", link.path, "page.tsx")))
      .map((link) => link.path);
    expect(missing).toEqual([]);
  });

  test("the footer has three link columns", () => {
    expect(FOOTER.columns.map((column) => column.title)).toEqual(["Product", "Docs", "Resources"]);
  });

  test("icons come from Phosphor only", () => {
    expect(text).not.toMatch(/from\s+["'](lucide-react|@tabler\/icons-react|react-icons[^"']*|@heroicons\/[^"']*)["']/);
  });

  test("the demo panel has five tasks and each section has features", () => {
    expect(TASKS).toHaveLength(5);
    expect(EVALUATE.features).toHaveLength(4);
    expect(SWAP.features).toHaveLength(3);
  });
});
