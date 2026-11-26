import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Badge } from "@modelstill/ui/components/badge";
import { Switch } from "@modelstill/ui/components/switch";
import { TableHead } from "@modelstill/ui/components/table";
import { cn } from "@modelstill/ui/lib/utils";

afterEach(cleanup);

const ROOTS = [
  join(import.meta.dir, "..", "src"),
  join(import.meta.dir, "..", "..", "..", "apps", "website", "src"),
  join(import.meta.dir, "..", "..", "..", "apps", "docs", "src"),
  join(import.meta.dir, "..", "..", "..", "apps", "landing", "src"),
];
const OTHER_ICON_LIBRARIES = /from\s+["'](lucide-react|@tabler\/icons-react|react-icons[^"']*|@heroicons\/[^"']*|@radix-ui\/react-icons|@hugeicons\/[^"']*)["']/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Switch", () => {
  test("flips its checked state and reports it", () => {
    const seen: boolean[] = [];
    render(<Switch aria-label="Serve" onCheckedChange={(value) => seen.push(value)} />);
    const control = screen.getByRole("switch", { name: "Serve" });
    expect(control.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(control);
    expect(control.getAttribute("data-state")).toBe("checked");
    expect(seen).toEqual([true]);
  });

  test("is 24 by 14 with a 10px thumb on the switch track colour", () => {
    render(<Switch aria-label="Serve" defaultChecked />);
    const control = screen.getByRole("switch", { name: "Serve" });
    expect(control.className).toContain("h-3.5");
    expect(control.className).toContain("w-6");
    expect(control.className).toContain("data-[state=checked]:bg-switch-on");
    expect(control.querySelector("[data-slot=switch-thumb]")?.className).toContain("size-2.5");
  });
});

describe("Badge", () => {
  test("a success badge uses the green badge colours with a 6px radius", () => {
    render(<Badge variant="success">passed</Badge>);
    const badge = screen.getByText("passed");
    expect(badge.className).toContain("bg-badge-ok-bg");
    expect(badge.className).toContain("text-badge-ok");
    expect(badge.className).toContain("rounded-(--radius-badge)");
    expect(badge.className).toContain("h-5");
  });
});

describe("Type styles", () => {
  test("survive class merging next to a text colour", () => {
    expect(cn("type-label text-muted-foreground")).toContain("type-label");
    expect(cn("type-title", "text-foreground")).toContain("type-title");
  });

  test("table headers are labels on a 40px row", () => {
    render(
      <table>
        <thead>
          <tr>
            <TableHead>Check</TableHead>
          </tr>
        </thead>
      </table>,
    );
    const head = screen.getByText("Check");
    expect(head.className).toContain("type-label");
    expect(head.className).toContain("h-(--grid-row-h)");
  });
});

describe("Icons", () => {
  test("every scanned root holds source files, so a moved app cannot pass the scan unseen", () => {
    expect(ROOTS.map((root) => sources(root).length > 0)).toEqual(ROOTS.map(() => true));
  });

  test("the dashboard, the docs and the UI package import icons from Phosphor only", () => {
    const offenders = ROOTS.flatMap(sources).filter((path) => OTHER_ICON_LIBRARIES.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
