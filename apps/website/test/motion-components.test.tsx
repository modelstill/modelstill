import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyButton } from "../src/components/motion/copy-button";
import { CountingNumber } from "../src/components/motion/counting-number";
import { Fade } from "../src/components/motion/fade";
import { Highlight, HighlightItem } from "../src/components/motion/highlight";
import { Slide } from "../src/components/motion/slide";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/motion/tabs";
import { Zoom } from "../src/components/motion/zoom";

afterEach(cleanup);

describe("CountingNumber", () => {
  test("ends on the target value", async () => {
    render(<CountingNumber number={1234} format={(value) => Math.round(value).toString()} />);
    await waitFor(() => expect(screen.getByText("1234")).toBeTruthy());
  });

  test("counts again from where it stopped when the target changes", async () => {
    const view = render(<CountingNumber number={10} format={(value) => Math.round(value).toString()} />);
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    view.rerender(<CountingNumber number={25} format={(value) => Math.round(value).toString()} />);
    await waitFor(() => expect(screen.getByText("25")).toBeTruthy());
  });
});

describe("CopyButton", () => {
  test("copies its content and shows the copied state", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void writes.push(text) },
      configurable: true,
    });
    render(<CopyButton content="hello" label="Copy" aria-label="Copy greeting" />);
    const button = screen.getByRole("button", { name: "Copy greeting" });
    expect(button.getAttribute("data-copied")).toBeNull();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writes).toEqual(["hello"]);
    await waitFor(() => expect(button.getAttribute("data-copied")).toBe("true"));
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  test("an icon-only button has no visible label", () => {
    render(<CopyButton content="x" aria-label="Copy x" />);
    expect(screen.getByRole("button", { name: "Copy x" }).textContent).toBe("");
  });
});

describe("enter effects", () => {
  test("Fade, Slide and Zoom render their children and pass props through", () => {
    render(
      <>
        <Fade data-slot="fade-box">fading</Fade>
        <Slide direction="left" offset={12} data-slot="slide-box">
          sliding
        </Slide>
        <Zoom asChild initialScale={0.6}>
          <span data-slot="zoom-box">zooming</span>
        </Zoom>
      </>,
    );
    expect(screen.getByText("fading").getAttribute("data-slot")).toBe("fade-box");
    expect(screen.getByText("sliding").getAttribute("data-slot")).toBe("slide-box");
    const zoom = screen.getByText("zooming");
    expect(zoom.tagName).toBe("SPAN");
    expect(zoom.getAttribute("data-slot")).toBe("zoom-box");
  });
});

describe("Highlight", () => {
  test("draws the indicator behind the active item only", () => {
    const items = (value: string | null) => (
      <Highlight value={value} className="inset-0">
        <HighlightItem value="a">
          <a href="#a">A</a>
        </HighlightItem>
        <HighlightItem value="b">
          <a href="#b">B</a>
        </HighlightItem>
      </Highlight>
    );
    const view = render(items("a"));
    const owners = () => [...view.container.querySelectorAll("[data-slot=motion-highlight]")].map((node) => node.parentElement?.querySelector("a")?.getAttribute("href"));
    expect(owners()).toEqual(["#a"]);
    view.rerender(items("b"));
    expect(owners()).toEqual(["#b"]);
    view.rerender(items(null));
    expect(owners()).toEqual([]);
  });
});

describe("Tabs", () => {
  test("switches panels and moves the indicator to the active tab", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">first panel</TabsContent>
        <TabsContent value="two">second panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("first panel")).toBeTruthy();
    const two = screen.getByRole("tab", { name: "Two" });
    fireEvent.mouseDown(two);
    fireEvent.click(two);
    expect(two.getAttribute("data-state")).toBe("active");
    expect(screen.getByText("second panel")).toBeTruthy();
    expect(two.querySelector("[data-slot=tabs-indicator]")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "One" }).querySelector("[data-slot=tabs-indicator]")).toBeNull();
  });

  test("follows a controlled value", () => {
    const changes: string[] = [];
    const view = render(
      <Tabs value="one" onValueChange={(value) => changes.push(value)}>
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Two" }));
    expect(new Set(changes)).toEqual(new Set(["two"]));
    expect(screen.getByRole("tab", { name: "One" }).getAttribute("data-state")).toBe("active");
    view.rerender(
      <Tabs value="two" onValueChange={(value) => changes.push(value)}>
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "Two" }).getAttribute("data-state")).toBe("active");
  });
});
