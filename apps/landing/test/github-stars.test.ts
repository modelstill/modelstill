import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatStars, REPO_API, shownStars, starsFrom } from "../src/lib/github-stars.ts";

describe("GitHub star button", () => {
  test("reads the count from the GitHub repository API", () => {
    expect(REPO_API).toBe("https://api.github.com/repos/modelstill/modelstill");
    expect(starsFrom({ stargazers_count: 31003 })).toBe(31003);
    expect(starsFrom({ stargazers_count: 0 })).toBe(0);
  });

  test("gives no count for a missing, private or malformed response", () => {
    expect(starsFrom({ message: "Not Found" })).toBeNull();
    expect(starsFrom(null)).toBeNull();
    expect(starsFrom({ stargazers_count: "12" })).toBeNull();
    expect(starsFrom({ stargazers_count: -1 })).toBeNull();
  });

  test("shows a count only once the repository has stars", () => {
    expect(shownStars(null)).toBeNull();
    expect(shownStars(0)).toBeNull();
    expect(shownStars(1)).toBe("1");
    expect(shownStars(31003)).toBe("31,003");
  });

  test("formats the count with thousands separators", () => {
    expect(formatStars(31003)).toBe("31,003");
    expect(formatStars(7)).toBe("7");
    expect(formatStars(1250000)).toBe("1,250,000");
  });

  test("the header shows the star button on desktop and keeps the icon on phones", () => {
    const header = readFileSync(join(import.meta.dir, "..", "src", "components", "header.tsx"), "utf8");
    expect(header).toContain("<GithubStars");
    const button = readFileSync(join(import.meta.dir, "..", "src", "components", "github-stars.tsx"), "utf8");
    expect(button).toContain(">Star<");
    expect(button).toContain("GithubLogoIcon");
    expect(button).toContain("aria-label");
  });
});
