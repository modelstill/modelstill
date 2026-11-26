import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CountUp } from "../src/components/motion/count-up";
import { OnboardingProvider } from "../src/components/onboarding/onboarding-state";
import { StepTransition } from "../src/components/onboarding/step-transition";
import { CopyButton } from "../src/components/motion/copy-button";
import { fixedFormat, formatCount, slideFrom, stepDirection } from "../src/lib/motion";
import { APP_THEME, THEME_SWITCHING_ENABLED, themeProviderProps } from "../src/lib/theme";

afterEach(cleanup);

describe("motion helpers", () => {
  test("a step forward or the first step enters from the right", () => {
    expect(stepDirection(null, 1)).toBe(1);
    expect(stepDirection(1, 2)).toBe(1);
  });

  test("a step back enters from the left", () => {
    expect(stepDirection(3, 2)).toBe(-1);
  });

  test("a forward step slides in leftward from the right, a step back rightward from the left", () => {
    expect(slideFrom(1)).toBe("left");
    expect(slideFrom(-1)).toBe("right");
  });

  test("counts are whole numbers with thousands separators", () => {
    expect(formatCount(9411.6)).toBe("9,412");
    expect(fixedFormat(3)(0.8467)).toBe("0.847");
  });
});

describe("theme", () => {
  test("the dashboard is light and ignores the system theme", () => {
    expect(APP_THEME).toBe("light");
    expect(THEME_SWITCHING_ENABLED).toBe(false);
    expect(themeProviderProps()).toMatchObject({ defaultTheme: "light", forcedTheme: "light", enableSystem: false });
  });

  test("switching can be turned back on in one place", () => {
    expect(themeProviderProps(true).forcedTheme).toBeUndefined();
    expect(themeProviderProps(true).enableSystem).toBe(false);
  });
});

describe("CountUp", () => {
  test("lands on the formatted value", async () => {
    render(<CountUp value={9412} />);
    await waitFor(() => expect(screen.getByText("9,412")).toBeTruthy());
  });

  test("uses the given format", async () => {
    render(<CountUp value={0.4213} format={fixedFormat(2)} />);
    await waitFor(() => expect(screen.getByText("0.42")).toBeTruthy());
  });

  test("a missing value shows the fallback", () => {
    render(<CountUp value={null} />);
    expect(screen.getByText("n/a")).toBeTruthy();
  });
});

describe("CopyButton", () => {
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  }

  test("copies, says so, then goes back to its label", async () => {
    const writes: string[] = [];
    stubClipboard(async (text) => {
      writes.push(text);
    });
    render(<CopyButton content="ms_live_abc" label="Copy key" delay={30} aria-label="Copy API key" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
    });
    expect(writes).toEqual(["ms_live_abc"]);
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    expect(screen.getByRole("button").getAttribute("data-copied")).toBe("true");
    await waitFor(() => expect(screen.getByText("Copy key")).toBeTruthy());
  });

  test("a failed copy is reported and the label stays", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const onCopyError = mock(() => {});
    render(<CopyButton content="x" label="Copy" onCopyError={onCopyError} aria-label="Copy it" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy it" }));
    });
    await waitFor(() => expect(onCopyError).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Copy")).toBeTruthy();
  });
});

describe("StepTransition", () => {
  function Step({ step }: { step: number }) {
    return (
      <StepTransition key={step} step={step}>
        <p>step {step}</p>
      </StepTransition>
    );
  }

  test("going back a step slides in from the other side", () => {
    const view = render(
      <OnboardingProvider>
        <Step step={3} />
      </OnboardingProvider>,
    );
    expect(view.container.querySelector("[data-slot=step-transition]")?.getAttribute("data-direction")).toBe("1");
    view.rerender(
      <OnboardingProvider>
        <Step step={2} />
      </OnboardingProvider>,
    );
    expect(screen.getByText("step 2")).toBeTruthy();
    expect(view.container.querySelector("[data-slot=step-transition]")?.getAttribute("data-direction")).toBe("-1");
  });

  test("works without the onboarding provider", () => {
    render(<Step step={1} />);
    expect(screen.getByText("step 1")).toBeTruthy();
  });
});
