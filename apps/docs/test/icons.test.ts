import { describe, expect, test } from "bun:test";
import { isValidElement } from "react";
import { ICONS, iconFor } from "../src/lib/icons.tsx";
import { frontmatter, mdxFiles, metaFiles, read, relativeToContent } from "./content.ts";

const PHOSPHOR_IMPORT = /^import\s+\{[^}]*\}\s+from\s+["']@phosphor-icons\/react\/ssr["'];?$/;

describe("page and folder icons", () => {
  test("every frontmatter icon names a Phosphor icon in the map", () => {
    const unknown = mdxFiles()
      .map((file) => [relativeToContent(file), frontmatter(file).icon] as const)
      .filter(([, icon]) => icon !== undefined && !(icon in ICONS));
    expect(unknown).toEqual([]);
  });

  test("every meta.json icon names a Phosphor icon in the map", () => {
    const unknown = metaFiles()
      .map((file) => [relativeToContent(file), (JSON.parse(read(file)) as { icon?: string }).icon] as const)
      .filter(([, icon]) => icon !== undefined && !(icon in ICONS));
    expect(unknown).toEqual([]);
  });

  test("a known name resolves to an element and an unknown one to nothing", () => {
    expect(isValidElement(iconFor("Rocket"))).toBe(true);
    expect(iconFor("NoSuchIcon")).toBeUndefined();
    expect(iconFor(undefined)).toBeUndefined();
  });

  test("MDX pages import icons from Phosphor only", () => {
    const offenders = mdxFiles().flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) => /^import\s/.test(line) && /icons|lucide/.test(line) && !PHOSPHOR_IMPORT.test(line.trim()))
        .map((line) => `${relativeToContent(file)}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
