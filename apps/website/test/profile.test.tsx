import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProfileSettings } from "../src/components/settings/profile-settings";

afterEach(cleanup);

describe("ProfileSettings", () => {
  test("saves a trimmed name", async () => {
    const save = mock(async (_name: string) => {});
    render(<ProfileSettings initialName="Ada" email="ada@x.io" save={save} onSignOut={async () => {}} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Ada Lovelace " } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("Ada Lovelace"));
    expect(await screen.findByRole("button", { name: /Saved/ })).toBeDefined();
  });

  test("an empty name cannot be saved", () => {
    render(<ProfileSettings initialName="" email="ada@x.io" save={async () => {}} onSignOut={async () => {}} />);
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows the email and signs out", async () => {
    const signOut = mock(async () => {});
    render(<ProfileSettings initialName="Ada" email="ada@x.io" save={async () => {}} onSignOut={signOut} />);
    expect(screen.getByText("ada@x.io")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
