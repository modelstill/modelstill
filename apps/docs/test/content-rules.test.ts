import { describe, expect, test } from "bun:test";
import { frontmatter, mdxFiles, read, relativeToContent } from "./content.ts";

const FORBIDDEN = [
  /[/]Users[/]/,
  new RegExp(["jobs", "pipe"].join(""), "i"),
  /tailscale/i,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /ms_live_[A-Za-z0-9]{12,}/,
  /modelstill\.dev/,
];

function offenders(check: (text: string) => boolean): string[] {
  return mdxFiles()
    .filter((file) => check(read(file)))
    .map(relativeToContent);
}

describe("docs content", () => {
  test("holds no private paths, internal hostnames, IP addresses, real keys or unbought domains", () => {
    expect(offenders((text) => FORBIDDEN.some((pattern) => pattern.test(text)))).toEqual([]);
  });

  test("has no MDX comments", () => {
    expect(offenders((text) => text.includes("{/*"))).toEqual([]);
  });

  test("no frontmatter value holds an unquoted colon and space, which YAML reads as a nested key", () => {
    const broken = mdxFiles().flatMap((file) =>
      Object.entries(frontmatter(file))
        .filter(([, value]) => value.includes(": ") && !/^["']/.test(value))
        .map(([key]) => `${relativeToContent(file)}: ${key}`),
    );
    expect(broken).toEqual([]);
  });

  test("every page has a title and a description", () => {
    const missing = mdxFiles()
      .filter((file) => !frontmatter(file).title || !frontmatter(file).description)
      .map(relativeToContent);
    expect(missing).toEqual([]);
  });
});
