import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CodeBlock } from "@modelstill/ui/blocks/code-block";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@modelstill/ui/components/alert-dialog";

afterEach(cleanup);

describe("AlertDialog", () => {
  test("asks before the action runs", async () => {
    const confirm = mock(() => {});
    render(
      <AlertDialog>
        <AlertDialogTrigger>Revoke</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>Anything using it stops working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Revoke key</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(screen.getByText("Anything using it stops working.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe("CodeBlock", () => {
  test("shows the code with a label and copies it", async () => {
    const writeText = mock(async (_value: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock label="Claude Code" code="claude mcp add --transport http modelstill http://x/mcp" />);
    expect(screen.getByText("Claude Code")).toBeDefined();
    expect(screen.getByText("claude mcp add --transport http modelstill http://x/mcp")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Copy Claude Code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("claude mcp add --transport http modelstill http://x/mcp"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
  });
});
