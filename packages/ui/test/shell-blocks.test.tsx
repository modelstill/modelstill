import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GearSixIcon } from "@phosphor-icons/react";
import { BrandLockup, Logo, LogoMark } from "@modelstill/ui/blocks/brand";
import { UserMenu } from "@modelstill/ui/blocks/user-menu";
import { WorkspaceSwitcher } from "@modelstill/ui/blocks/workspace-switcher";

afterEach(cleanup);

function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

describe("BrandLockup", () => {
  test("shows the still mark and the ModelStill wordmark as a home link", () => {
    render(<BrandLockup href="/tasks" />);
    const link = screen.getByRole("link", { name: "ModelStill home" });
    expect(link.getAttribute("href")).toBe("/tasks");
    expect(link.querySelector("svg[data-slot='brand-mark']")).toBeTruthy();
    expect(screen.getByText("ModelStill")).toBeTruthy();
  });

  test("drops the wordmark when compact", () => {
    render(<BrandLockup href="/tasks" compact />);
    expect(screen.queryByText("ModelStill")).toBeNull();
  });
});

describe("LogoMark", () => {
  test("draws a brand tile with two bars and a drop, sized on request", () => {
    const { container } = render(<LogoMark size={40} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("rect").length).toBe(3);
    expect(svg.querySelectorAll("circle").length).toBe(1);
  });
});

describe("Logo", () => {
  test("pairs the mark with the wordmark", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg[data-slot='brand-mark']")).toBeTruthy();
    expect(screen.getByText("ModelStill").className).toContain("brand-wordmark");
  });
});

describe("WorkspaceSwitcher", () => {
  const items = [
    { id: "job-titles", label: "job-titles", meta: "serve" },
    { id: "addresses", label: "addresses", meta: "shadow" },
  ];

  test("names the active item on the trigger", () => {
    render(<WorkspaceSwitcher label="Switch task" items={items} activeId="addresses" onSelect={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Switch task" });
    expect(trigger.textContent).toContain("addresses");
  });

  test("names the active id while the list is still loading", () => {
    render(<WorkspaceSwitcher label="Switch task" items={null} activeId="addresses" placeholder="Select a task" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Switch task" }).textContent).toContain("addresses");
  });

  test("shows the placeholder when nothing is active", () => {
    render(<WorkspaceSwitcher label="Switch task" items={items} activeId={null} placeholder="Select a task" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Switch task" }).textContent).toContain("Select a task");
  });

  test("filters items by the search box and selects one", async () => {
    const chosen: string[] = [];
    render(<WorkspaceSwitcher label="Switch task" items={items} activeId="job-titles" onSelect={(id) => chosen.push(id)} searchPlaceholder="Find a task" />);
    openMenu("Switch task");
    const search = await waitFor(() => screen.getByPlaceholderText("Find a task"));
    fireEvent.change(search, { target: { value: "addr" } });
    expect(screen.queryByRole("menuitem", { name: /job-titles/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /addresses/ }));
    expect(chosen).toEqual(["addresses"]);
  });

  test("says when the list is still loading", async () => {
    render(<WorkspaceSwitcher label="Switch task" items={null} activeId={null} onSelect={() => {}} loadingText="Loading tasks..." />);
    openMenu("Switch task");
    await waitFor(() => expect(screen.getByText("Loading tasks...")).toBeTruthy());
  });
});

describe("UserMenu", () => {
  test("shows the name and detail and runs a menu item", async () => {
    const ran: string[] = [];
    render(
      <UserMenu
        name="Local workspace"
        detail="http://localhost:8787"
        items={[{ id: "settings", label: "Settings", icon: GearSixIcon, onSelect: () => ran.push("settings") }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Local workspace/ });
    expect(trigger.textContent).toContain("http://localhost:8787");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await waitFor(() => screen.getByRole("menuitem", { name: "Settings" })));
    expect(ran).toEqual(["settings"]);
  });
});
