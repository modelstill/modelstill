import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { DistilScene } from "../src/components/auth/distil-scene";
import { SceneGradient } from "../src/components/auth/scene-gradient";
import { TerminalLine, TerminalPanel } from "../src/components/onboarding/terminal";
import { EXAMPLE_FLOW } from "../src/lib/scene";
import pkg from "../package.json";

afterEach(cleanup);

describe("example flow", () => {
  test("runs record, distil, gate, serve with the gate still checking", () => {
    expect(EXAMPLE_FLOW.map((step) => step.key)).toEqual(["record", "distil", "gate", "serve"]);
    expect(EXAMPLE_FLOW.find((step) => step.key === "gate")?.state).toBe("checking");
    expect(EXAMPLE_FLOW.find((step) => step.key === "serve")?.state).toBe("waiting");
  });

  test("the sign-in card is labelled as an example and claims no result", () => {
    const view = render(<DistilScene />);
    expect(screen.getByText("Example")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Example flow" })).toBeTruthy();
    const text = view.container.textContent ?? "";
    expect(text).not.toMatch(/passed/i);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/\d\.\d/);
    expect(view.container.querySelectorAll("[data-slot=flow-connector]").length).toBe(3);
    expect(view.container.querySelector("svg[data-slot=animated-beam]")).toBeNull();
  });

  test("onboarding terminals are labelled as examples", () => {
    render(
      <TerminalPanel title="claude">
        <TerminalLine prompt>claude</TerminalLine>
      </TerminalPanel>,
    );
    expect(screen.getByText("Example")).toBeTruthy();
  });
});

describe("scene gradient", () => {
  test("is a CSS wash with grain: no image, no canvas", () => {
    const view = render(<SceneGradient />);
    const root = view.container.querySelector("[data-slot=scene-gradient]");
    expect(root?.classList.contains("scene-wash")).toBe(true);
    expect(view.container.querySelector(".scene-grain")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("canvas")).toBeNull();
  });

  test("the website ships no WebGL libraries", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const name of ["three", "@react-three/fiber", "@shadergradient/react"]) expect(deps).not.toContain(name);
  });
});
