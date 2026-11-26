import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlaskIcon, TerminalIcon } from "@phosphor-icons/react";
import { ActivityTimeline } from "@modelstill/ui/blocks/activity-timeline";
import { ApiCallBlock, CodeTabs } from "@modelstill/ui/blocks/code-panel";
import { SpecTable } from "@modelstill/ui/blocks/detail-header";
import { BarSparkline, DeltaLine, HeatmapGrid, LabelledBars, MetricWidget, TickProgress, WidgetPanel } from "@modelstill/ui/blocks/metric-widget";
import { ProgressRing } from "@modelstill/ui/blocks/progress-ring";
import { StepList } from "@modelstill/ui/blocks/step-list";
import { SyncTimeline } from "@modelstill/ui/blocks/connect-panel";
import { ChipList, ScoreMeter, TablePager, UsageMeter } from "@modelstill/ui/blocks/table-cells";
import { relativeDelta } from "@modelstill/ui/lib/delta";

afterEach(cleanup);

describe("metric widget", () => {
  test("shows the panel, the title and the description", () => {
    render(
      <MetricWidget title="Pass rate" description="Mean score of each eval run">
        <WidgetPanel label="Latest run" value="0.741" delta={<DeltaLine delta={relativeDelta(87.5, 100)} context="vs previous run" />}>
          <BarSparkline values={[1, 2, 3]} />
        </WidgetPanel>
      </MetricWidget>,
    );
    expect(screen.getByText("Pass rate")).toBeTruthy();
    expect(screen.getByText("0.741")).toBeTruthy();
    expect(screen.getByText("12.5%")).toBeTruthy();
    expect(screen.getByText("vs previous run")).toBeTruthy();
  });

  test("the sparkline highlights the last bar by default", () => {
    const { container } = render(<BarSparkline values={[3, 1, 2]} />);
    const bars = container.querySelectorAll("[data-slot=bar-sparkline] > span");
    expect(bars[2]!.getAttribute("data-highlight")).toBe("true");
    expect(bars[0]!.getAttribute("data-highlight")).toBeNull();
  });

  test("a missing delta says there is nothing to compare", () => {
    render(<DeltaLine delta={null} context="vs previous" />);
    expect(screen.getByText("no earlier value")).toBeTruthy();
  });

  test("the tick progress lights a share of its ticks", () => {
    const { container } = render(<TickProgress value={0.5} ticks={10} label="reviewed" />);
    expect(container.querySelectorAll("[data-on=true]")).toHaveLength(5);
  });

  test("the heatmap gives the busiest cell the top level", () => {
    const { container } = render(<HeatmapGrid cells={[0, 10, 40, null]} columns={4} />);
    expect([...container.querySelectorAll("[data-level]")].map((cell) => cell.getAttribute("data-level"))).toEqual(["0", "1", "4", "0"]);
  });

  test("labelled bars print each value", () => {
    render(<LabelledBars rows={[{ key: "a", label: "passed", value: 3, tone: "positive" }, { key: "b", label: "failed", value: 1, tone: "negative" }]} />);
    expect(screen.getByText("passed")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("table cells", () => {
  test("the score meter fills segments and takes the band tone", () => {
    const { container } = render(<ScoreMeter value={0.5} segments={10} />);
    expect(container.querySelectorAll("[data-on=true]")).toHaveLength(5);
    expect(container.querySelector("[data-slot=segment-meter]")!.getAttribute("data-tone")).toBe("warning");
  });

  test("a missing score reads n/a", () => {
    render(<ScoreMeter value={null} />);
    expect(screen.getByText("n/a")).toBeTruthy();
  });

  test("the chip list folds extra chips into a count", () => {
    render(<ChipList items={["read", "write", "admin", "push"]} max={2} />);
    expect(screen.getByText("read")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.queryByText("admin")).toBeNull();
  });

  test("usage without a limit says so", () => {
    render(<UsageMeter used={3} limit={null} />);
    expect(screen.getByText("No limit")).toBeTruthy();
  });

  test("the pager names the page and stops at the ends", () => {
    let page = 0;
    render(<TablePager page={1} pageCount={3} onPage={(next) => (page = next)} />);
    expect(screen.getByText(/Page 1 of 3/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page).toBe(2);
  });
});

describe("steps and timelines", () => {
  test("the step list marks the current step", () => {
    render(
      <StepList
        steps={[
          { key: "a", label: "Detail", state: "done" },
          { key: "b", label: "Review", state: "current" },
          { key: "c", label: "Secret key", state: "upcoming" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Review" }).getAttribute("aria-current")).toBe("step");
    expect((screen.getByRole("button", { name: "Secret key" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the activity timeline collapses and expands a step's JSON", () => {
    render(
      <ActivityTimeline
        icon={TerminalIcon}
        summary="3 steps"
        duration="6m 12s"
        steps={[{ key: "a", icon: FlaskIcon, title: "Eval at step 50", tags: ["eval"], json: { step: 50 } }]}
        done="Done"
      />,
    );
    expect(screen.getByText("6m 12s")).toBeTruthy();
    expect(screen.queryByText("JSON")).toBeNull();
    fireEvent.click(screen.getByText("Eval at step 50"));
    expect(screen.getByText("JSON")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  test("the sync timeline marks the last finished pill as synced", () => {
    const { container } = render(
      <SyncTimeline
        steps={[
          { key: "a", label: "Connected", state: "done" },
          { key: "b", label: "Synced", state: "done" },
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-slot=sync-pill]")).toHaveLength(2);
  });

  test("the progress ring reports its percentage", () => {
    render(<ProgressRing value={0.25} label="setup" />);
    expect(screen.getByRole("progressbar", { name: "setup" }).getAttribute("aria-valuenow")).toBe("25");
  });
});

describe("code and spec panels", () => {
  test("code tabs show the first tab's code", () => {
    render(<CodeTabs tabs={[{ value: "py", label: "Python", code: "print(1)" }, { value: "sh", label: "cURL", code: "curl x" }]} />);
    expect(screen.getByRole("tab", { name: "Python" }).getAttribute("data-state")).toBe("active");
    expect(screen.getByText("print")).toBeTruthy();
  });

  test("the API call block shows the method and path", () => {
    render(<ApiCallBlock method="POST" path="/v1/api-keys" code="curl https://api" />);
    expect(screen.getByText("POST")).toBeTruthy();
    expect(screen.getByText("/v1/api-keys")).toBeTruthy();
  });

  test("the spec table lists each row", () => {
    render(<SpecTable rows={[{ label: "Base", value: "Qwen" }]} />);
    expect(screen.getByText("Base")).toBeTruthy();
    expect(screen.getByText("Qwen")).toBeTruthy();
  });
});
