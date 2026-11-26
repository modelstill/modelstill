import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";


let pathname = "/tasks/technographics/evals";

const navigation = await import("next/navigation");

mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => pathname,
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const { Sidebar } = await import("../src/components/dashboard/sidebar");

afterEach(cleanup);

const account = { onSignOut: async () => {}, navigate: () => {} };

function indicators(container: HTMLElement) {
  return [...container.querySelectorAll("nav [data-slot=motion-highlight]")].map((node) => node.parentElement?.querySelector("a")?.getAttribute("href"));
}

function activeLinks(container: HTMLElement) {
  return [...container.querySelectorAll("a[aria-current=page]")].map((node) => node.getAttribute("href"));
}

describe("sidebar active indicator", () => {
  test("sits behind the active page only", () => {
    pathname = "/tasks/technographics/evals";
    const view = render(<Sidebar user={null} tasks={[]} onSearch={() => {}} account={account} />);
    expect(indicators(view.container)).toEqual(["/tasks/technographics/evals"]);
  });

  test("moves with the page", () => {
    pathname = "/tasks/technographics/evals";
    const view = render(<Sidebar user={null} tasks={[]} onSearch={() => {}} account={account} />);
    pathname = "/tasks/technographics/gates";
    view.rerender(<Sidebar user={null} tasks={[]} onSearch={() => {}} account={account} />);
    expect(indicators(view.container)).toEqual(["/tasks/technographics/gates"]);
    expect(activeLinks(view.container)).toEqual(["/tasks/technographics/gates"]);
  });

  test("the settings panel has its own indicator", () => {
    pathname = "/settings/api-keys";
    const view = render(<Sidebar user={null} tasks={[]} onSearch={() => {}} account={account} />);
    expect(indicators(view.container)).toEqual(["/settings/api-keys"]);
  });

  test("task pages are grouped under observe, evaluate and improve", () => {
    pathname = "/tasks/technographics/datasets";
    const view = render(<Sidebar user={null} tasks={[]} onSearch={() => {}} account={account} />);
    const labels = [...view.container.querySelectorAll("nav[aria-label]")].map((node) => node.getAttribute("aria-label"));
    expect(labels).toEqual(expect.arrayContaining(["Observe", "Evaluate", "Improve"]));
    expect(activeLinks(view.container)).toEqual(["/tasks/technographics/datasets"]);
  });
});

const task = (slug: string) => ({ slug, version: "1", snapshotHash: "abc", mode: "shadow" as const, deferralShare: 0.2, lastGatePassed: null });

describe("sidebar reference states", () => {
  test("get started shows setup progress as a ring", () => {
    pathname = "/tasks";
    const view = render(<Sidebar user={null} tasks={[task("a")]} onSearch={() => {}} account={account} />);
    const link = view.getByRole("link", { name: /Get started/ });
    expect(link.getAttribute("href")).toBe("/get-started");
    expect(view.getByRole("progressbar", { name: "Setup progress" }).getAttribute("aria-valuenow")).toBe("50");
  });

  test("the task list folds behind More and opens again with Less", () => {
    pathname = "/tasks";
    const view = render(<Sidebar user={null} tasks={["a", "b", "c", "d", "e"].map(task)} onSearch={() => {}} account={account} />);
    const list = () => [...view.container.querySelectorAll("[data-slot=sidebar-task]")].map((node) => node.textContent);
    expect(list()).toEqual(["a", "b", "c"]);
    fireEvent.click(view.getByRole("button", { name: "More" }));
    expect(list()).toEqual(["a", "b", "c", "d", "e"]);
    fireEvent.click(view.getByRole("button", { name: "Less" }));
    expect(list()).toHaveLength(3);
  });

  test("the segmented tabs switch to the settings panel", () => {
    pathname = "/tasks";
    const view = render(<Sidebar user={null} tasks={[]} onSearch={() => {}} account={account} />);
    const settingsTab = view.getByRole("tab", { name: "Settings" });
    fireEvent.mouseDown(settingsTab);
    fireEvent.click(settingsTab);
    expect(view.getByRole("tab", { name: "Settings" }).getAttribute("data-state")).toBe("active");
    expect(view.getByPlaceholderText("Find a setting").getAttribute("tabindex")).toBe("0");
  });

  test("the workspace menu has a sidebar toggle", () => {
    pathname = "/tasks";
    let toggled = 0;
    const view = render(<Sidebar user={null} tasks={[]} onSearch={() => {}} onToggle={() => (toggled += 1)} account={account} />);
    fireEvent.click(view.getByRole("button", { name: "Collapse sidebar" }));
    expect(toggled).toBe(1);
  });
});
