import { describe, expect, test } from "bun:test";
import {
  activeHref,
  activeTaskSection,
  breadcrumbs,
  compareHref,
  GET_STARTED_HREF,
  gateReportHref,
  isSettingsPath,
  MAIN_NAV,
  sectionForPath,
  SETTINGS_NAV,
  settingsNav,
  slugFromPath,
  taskNavGroups,
  taskSections,
  trainRunHref,
} from "../src/lib/nav";

describe("sectionForPath", () => {
  test("names the page's section for the top bar icon", () => {
    expect(sectionForPath("/tasks")).toBe("tasks");
    expect(sectionForPath("/tasks/t")).toBe("overview");
    expect(sectionForPath("/tasks/t/evals/compare")).toBe("evals");
    expect(sectionForPath("/tasks/t/traffic")).toBe("traffic");
    expect(sectionForPath("/tasks/t/training/k-1")).toBe("training");
  });
});

describe("task navigation", () => {
  test("lists every task screen under the slug", () => {
    expect(taskSections("my task").map((s) => s.href)).toEqual([
      "/tasks/my%20task",
      "/tasks/my%20task/traffic",
      "/tasks/my%20task/monitoring",
      "/tasks/my%20task/evals",
      "/tasks/my%20task/review",
      "/tasks/my%20task/datasets",
      "/tasks/my%20task/gates",
      "/tasks/my%20task/training",
      "/tasks/my%20task/deployment",
    ]);
  });

  test("groups the task screens into observe, evaluate and improve", () => {
    expect(taskNavGroups("t").map((group) => [group.label, group.items.map((item) => item.label)])).toEqual([
      [null, ["Overview"]],
      ["Observe", ["Traffic", "Monitoring"]],
      ["Evaluate", ["Evals", "Review", "Datasets", "Gates"]],
      ["Improve", ["Training", "Deployment"]],
    ]);
  });

  test("reads the slug from a task path", () => {
    expect(slugFromPath("/tasks/job-title/evals/compare")).toBe("job-title");
    expect(slugFromPath("/tasks/a%20b")).toBe("a b");
    expect(slugFromPath("/tasks")).toBeNull();
  });

  test("the active section is the longest matching prefix", () => {
    expect(activeTaskSection("/tasks/t/evals/compare", "t")).toBe("evals");
    expect(activeTaskSection("/tasks/t", "t")).toBe("overview");
    expect(activeTaskSection("/tasks/t/gates", "t")).toBe("gates");
  });

  test("a train run links under the task's training section", () => {
    expect(trainRunHref("my task", "k 1")).toBe("/tasks/my%20task/training/k%201");
  });

  test("the compare link carries both run ids", () => {
    expect(compareHref("t", "r1", "r 2")).toBe("/tasks/t/evals/compare?before=r1&after=r+2");
  });
});

describe("the sidebar", () => {
  test("the main panel starts with the task list", () => {
    expect(MAIN_NAV.map((section) => [section.label, section.items.map((item) => item.href)])).toEqual([[null, ["/tasks"]]]);
  });

  test("the settings panel lists account and developer pages", () => {
    expect(SETTINGS_NAV.map((section) => [section.label, section.items.map((item) => item.href)])).toEqual([
      ["Account", ["/settings/profile"]],
      ["Developers", ["/settings/api-keys", "/settings/mcp"]],
    ]);
  });

  test("inside a task the settings panel starts with the task's own page", () => {
    expect(settingsNav("t").map((section) => [section.label, section.items.map((item) => item.href)])).toEqual([
      ["Task", ["/tasks/t/settings"]],
      ["Account", ["/settings/profile"]],
      ["Developers", ["/settings/api-keys", "/settings/mcp"]],
    ]);
  });

  test("task settings is a settings page with its own crumbs", () => {
    expect(isSettingsPath("/tasks/t/settings")).toBe(true);
    expect(sectionForPath("/tasks/t/settings")).toBe("settings");
    expect(breadcrumbs("/tasks/t/settings")).toEqual([
      { label: "Tasks", href: "/tasks" },
      { label: "t", href: "/tasks/t" },
      { label: "Settings" },
    ]);
    expect(breadcrumbs("/settings/mcp")).toEqual([{ label: "Settings" }, { label: "Connect via MCP" }]);
  });

  test("new task pages have their own crumbs", () => {
    expect(breadcrumbs("/tasks/t/datasets")).toEqual([{ label: "Tasks", href: "/tasks" }, { label: "t", href: "/tasks/t" }, { label: "Datasets" }]);
    expect(sectionForPath("/tasks/t/deployment")).toBe("deployment");
  });

  test("settings paths slide the sidebar to its settings panel", () => {
    expect(isSettingsPath("/settings/profile")).toBe(true);
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settingsx")).toBe(false);
    expect(isSettingsPath("/tasks")).toBe(false);
  });

  test("the profile page has its own crumb", () => {
    expect(breadcrumbs("/settings/profile")).toEqual([{ label: "Settings" }, { label: "Profile" }]);
    expect(sectionForPath("/settings/profile")).toBe("settings");
  });
});

describe("active nav href", () => {
  test("is the first href the panel marks active", () => {
    expect(activeHref(["/tasks", "/connect", "/settings/api-keys"], (href) => href === "/connect")).toBe("/connect");
  });

  test("is null when nothing in the panel is active", () => {
    expect(activeHref(["/tasks", "/connect"], () => false)).toBeNull();
  });
});

describe("gate report", () => {
  test("lives under the task's gates with its own crumb", () => {
    expect(gateReportHref("t", "g-1234567890")).toBe("/tasks/t/gates/g-1234567890");
    expect(activeTaskSection("/tasks/t/gates/g-1234567890", "t")).toBe("gates");
    expect(breadcrumbs("/tasks/t/gates/g-1234567890")).toEqual([
      { label: "Tasks", href: "/tasks" },
      { label: "t", href: "/tasks/t" },
      { label: "Gates", href: "/tasks/t/gates" },
      { label: "Report g-123456" },
    ]);
  });
});

describe("get started", () => {
  test("has its own crumb and lives outside the settings panel", () => {
    expect(breadcrumbs(GET_STARTED_HREF)).toEqual([{ label: "Get started" }]);
    expect(isSettingsPath(GET_STARTED_HREF)).toBe(false);
  });
});
