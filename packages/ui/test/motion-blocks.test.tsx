import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { StepChart } from "@modelstill/ui/blocks/step-chart";
import { Badge } from "@modelstill/ui/components/badge";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";

afterEach(cleanup);

function indicatorOwner(container: HTMLElement) {
  const indicators = container.querySelectorAll("[data-slot=toggle-group-indicator]");
  return [...indicators].map((node) => node.closest("[data-slot=toggle-group-item]")?.textContent);
}

describe("ToggleGroup sliding indicator", () => {
  test("sits on the selected item and follows a click", async () => {
    const view = render(
      <ToggleGroup type="single" defaultValue="all" aria-label="Filter">
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="pending">Pending</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(indicatorOwner(view.container)).toEqual(["All"]);
    await act(async () => {
      fireEvent.click(screen.getByText("Pending"));
    });
    expect(indicatorOwner(view.container)).toEqual(["Pending"]);
  });

  test("follows a controlled value and the change still reaches the caller", async () => {
    function Controlled() {
      const [value, setValue] = useState("24");
      return (
        <>
          <ToggleGroup type="single" value={value} onValueChange={(next) => next && setValue(next)}>
            <ToggleGroupItem value="24">24 h</ToggleGroupItem>
            <ToggleGroupItem value="168">7 d</ToggleGroupItem>
          </ToggleGroup>
          <output>{value}</output>
        </>
      );
    }
    const view = render(<Controlled />);
    await act(async () => {
      fireEvent.click(screen.getByText("7 d"));
    });
    expect(screen.getByText("168", { selector: "output" })).toBeTruthy();
    expect(indicatorOwner(view.container)).toEqual(["7 d"]);
  });

  test("a multiple-choice group has no indicator", () => {
    const view = render(
      <ToggleGroup type="multiple" defaultValue={["a"]}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(indicatorOwner(view.container)).toEqual([]);
  });
});

describe("motion classes", () => {
  test("a step chart draws in only when asked", () => {
    const rows = [
      { step: 1, loss: 2 },
      { step: 2, loss: 1 },
    ];
    const still = render(<StepChart data={rows} series={[{ key: "loss", label: "Loss" }]} />);
    expect(still.container.querySelector("[data-draw-in]")).toBeNull();
    cleanup();
    const drawn = render(<StepChart data={rows} series={[{ key: "loss", label: "Loss" }]} drawIn />);
    expect(drawn.container.querySelector("[data-draw-in]")).not.toBeNull();
  });

  test("a badge scales in and stays still under reduced motion", () => {
    render(<Badge>Passed</Badge>);
    const badge = screen.getByText("Passed");
    expect(badge.className).toContain("zoom-in-90");
    expect(badge.className).toContain("motion-reduce:animate-none");
  });
});
