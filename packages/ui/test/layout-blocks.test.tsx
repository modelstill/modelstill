import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppShell } from "@modelstill/ui/blocks/app-shell";
import { CommandPalette } from "@modelstill/ui/blocks/command-palette";
import { PageHeader } from "@modelstill/ui/blocks/page-header";
import { Section } from "@modelstill/ui/blocks/section";
import { EmptyState, ErrorState, LoadingState } from "@modelstill/ui/blocks/states";
import { Toolbar } from "@modelstill/ui/blocks/toolbar";
import { DeferralChart, LatencyChart, RequestsChart, type TrafficPoint } from "@modelstill/ui/blocks/traffic-charts";
import { StepChart } from "@modelstill/ui/blocks/step-chart";

afterEach(cleanup);

describe("AppShell", () => {
  test("renders the sidebar, the top bar and the content", () => {
    render(
      <AppShell sidebar={<nav aria-label="Main">nav</nav>} topbar={<span>crumbs</span>}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByText("crumbs")).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy();
  });
});

describe("PageHeader", () => {
  test("shows the title as a heading with description and actions", () => {
    render(<PageHeader title="Eval runs" description="Scores with intervals." actions={<button type="button">Compare</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Eval runs" })).toBeTruthy();
    expect(screen.getByText("Scores with intervals.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy();
  });

  test("renders breadcrumb items with links for all but the last", () => {
    render(<PageHeader title="Compare" breadcrumb={[{ label: "Tasks", href: "/tasks" }, { label: "Compare" }]} />);
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe("/tasks");
    expect(screen.getByText("Compare", { selector: "[aria-current=page]" })).toBeTruthy();
  });
});

describe("Section and Toolbar", () => {
  test("a section has a labelled heading and its children", () => {
    render(
      <Section title="Latest gate" actions={<a href="/g">Gate history</a>}>
        <p>body</p>
      </Section>,
    );
    expect(screen.getByRole("region", { name: "Latest gate" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Gate history" })).toBeTruthy();
  });

  test("a toolbar is a labelled toolbar", () => {
    render(
      <Toolbar aria-label="Runs">
        <span>2 selected</span>
      </Toolbar>,
    );
    expect(screen.getByRole("toolbar", { name: "Runs" }).textContent).toContain("2 selected");
  });
});

describe("states", () => {
  test("loading is a busy status", () => {
    render(<LoadingState rows={2} />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  test("an error shows its message and retries", () => {
    let retried = 0;
    render(<ErrorState error={new Error("API unreachable at http://x")} onRetry={() => retried++} />);
    expect(screen.getByRole("alert").textContent).toContain("API unreachable at http://x");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retried).toBe(1);
  });

  test("empty shows its title and description", () => {
    render(<EmptyState title="No runs" description="Run an eval first." />);
    expect(screen.getByText("No runs")).toBeTruthy();
    expect(screen.getByText("Run an eval first.")).toBeTruthy();
  });
});

describe("CommandPalette", () => {
  test("opens with the keyboard shortcut and runs the chosen item", async () => {
    const chosen: string[] = [];
    render(
      <CommandPalette
        groups={[
          {
            heading: "Tasks",
            items: [
              { id: "a", label: "job-titles", onSelect: () => chosen.push("a") },
              { id: "b", label: "addresses", onSelect: () => chosen.push("b") },
            ],
          },
        ]}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByText("addresses"));
    expect(chosen).toEqual(["b"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("traffic charts", () => {
  const data: TrafficPoint[] = [
    { label: "11-20 10:00", total: 10, student: 8, deferred: 2, mismatch: 0, p95Student: 120, p95Cloud: 800 },
    { label: "11-20 11:00", total: 12, student: 9, deferred: 3, mismatch: 1, p95Student: 130, p95Cloud: null },
  ];

  test("each chart renders inside a chart container", () => {
    render(
      <>
        <RequestsChart data={data} />
        <DeferralChart data={data} />
        <LatencyChart data={data} />
      </>,
    );
    expect(document.querySelectorAll("[data-slot=chart]")).toHaveLength(3);
  });
});

describe("step chart", () => {
  test("draws one line per series over the step axis", () => {
    render(
      <StepChart
        data={[
          { step: 10, loss: 1.4, eval_loss: null },
          { step: 20, loss: 1.1, eval_loss: 0.9 },
        ]}
        series={[
          { key: "loss", label: "Train loss" },
          { key: "eval_loss", label: "Eval loss", dashed: true },
        ]}
      />,
    );
    const chart = document.querySelector("[data-slot=chart]");
    expect(chart).toBeTruthy();
    expect(chart!.getAttribute("data-series")).toBe("loss eval_loss");
  });
});
