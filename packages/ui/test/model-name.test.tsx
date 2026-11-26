import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ModelName } from "@modelstill/ui/blocks/model-name";

afterEach(cleanup);

describe("ModelName", () => {
  test("shows the provider icon before the model id", () => {
    const { container } = render(<ModelName model="Qwen/Qwen3-1.7B" />);
    expect(screen.getByText("Qwen/Qwen3-1.7B")).toBeDefined();
    expect(container.querySelector("[data-slot=provider-icon]")?.getAttribute("data-provider")).toBe("qwen");
  });

  test("an unknown model gets the letter fallback, a missing one says unknown", () => {
    const { container, rerender } = render(<ModelName model="house-model" />);
    expect(container.querySelector("[data-slot=provider-icon]")?.getAttribute("data-provider")).toBe("unknown");
    rerender(<ModelName model={null} />);
    expect(screen.getByText("unknown")).toBeDefined();
    expect(container.querySelector("[data-slot=provider-icon]")).toBeNull();
  });
});
