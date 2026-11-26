import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportPanel } from "../src/components/datasets/import-panel";
import { RowEditor } from "../src/components/datasets/row-editor";
import type { CaseRow, RowRevision } from "../src/lib/cases-api";

const row: CaseRow = { id: "fr", input: { question: "Capital of France?" }, expected: "Paris", metadata: { tags: ["europe"] }, version: 1, position: 1 };

const history: RowRevision[] = [
  { rowId: "fr", version: 2, deleted: false, input: row.input, expected: "Paris, France", metadata: row.metadata, author: "dana", createdAt: "2026-11-24T10:05:00.000Z" },
  { rowId: "fr", version: 1, deleted: false, input: row.input, expected: "Paris", metadata: row.metadata, author: "dana", createdAt: "2026-11-24T10:00:00.000Z" },
];

describe("row editor", () => {
  afterEach(cleanup);

  test("an edit is handed to autosave once it parses", () => {
    const onChange = mock(() => {});
    render(<RowEditor row={row} readOnly={false} onChange={onChange} onDelete={async () => {}} loadHistory={async () => history} historyKey={1} />);
    fireEvent.change(screen.getByLabelText("Expected"), { target: { value: "Paris, France" } });
    expect(onChange).toHaveBeenLastCalledWith("fr", { expected: "Paris, France" });
    fireEvent.change(screen.getByLabelText("Metadata"), { target: { value: "[1]" } });
    expect(screen.getByText("metadata is a JSON object")).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("shows the row's change history with who changed what", async () => {
    render(<RowEditor row={row} readOnly={false} onChange={() => {}} onDelete={async () => {}} loadHistory={async () => history} historyKey={1} />);
    await waitFor(() => expect(screen.getByText("expected changed")).toBeTruthy());
    expect(screen.getByText("created")).toBeTruthy();
    expect(screen.getAllByText(/dana/).length).toBe(2);
  });

  test("delete asks in an in-page dialog, never the browser", async () => {
    const confirm = mock(() => true);
    window.confirm = confirm;
    const onDelete = mock(async () => {});
    render(<RowEditor row={row} readOnly={false} onChange={() => {}} onDelete={onDelete} loadHistory={async () => []} historyKey={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete case" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete case fr?");
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(onDelete).toHaveBeenCalledWith("fr");
    expect(confirm).not.toHaveBeenCalled();
  });

  test("an older version is read-only", () => {
    render(<RowEditor row={row} readOnly onChange={() => {}} onDelete={async () => {}} loadHistory={async () => []} historyKey={1} />);
    expect((screen.getByLabelText("Expected") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Delete case" })).toBeNull();
  });
});

describe("import panel", () => {
  afterEach(cleanup);

  async function load(name: string, text: string, existingIds = new Set<string>()) {
    const onImport = mock(async () => {});
    render(<ImportPanel existingIds={existingIds} onImport={onImport} />);
    const file = new File([text], name, { type: "text/plain" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
    });
    await screen.findByText(/columns/);
    return onImport;
  }

  test("maps columns, previews the first rows and imports the cases", async () => {
    const onImport = await load("capitals.csv", "id,question,answer\nfr,Capital of France?,Paris\njp,Capital of Japan?,Tokyo\n");
    expect(screen.getByTestId("mapping-question").textContent).toContain("Input");
    expect(screen.getByTestId("mapping-answer").textContent).toContain("Expected");
    expect(screen.getAllByTestId("preview-row")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import 2 cases" }));
    });
    expect(onImport).toHaveBeenCalledWith([
      { id: "fr", input: "Capital of France?", expected: "Paris", metadata: {} },
      { id: "jp", input: "Capital of Japan?", expected: "Tokyo", metadata: {} },
    ]);
  });

  test("lists every row error and blocks the import", async () => {
    const onImport = await load("capitals.jsonl", '{"id":"fr","input":"x"}\n{"id":"fr","input":"y"}\n{"id":"de","input":""}\n', new Set(["de"]));
    expect(screen.getByText("Row 2: id fr is already used on row 1")).toBeTruthy();
    expect(screen.getByText("Row 3: the input is empty")).toBeTruthy();
    expect(screen.getByText("Row 3: id de is already in the dataset")).toBeTruthy();
    const button = screen.getByRole("button", { name: /Import/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(onImport).not.toHaveBeenCalled();
  });
});
