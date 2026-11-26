import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { CodeId, truncateId } from "@modelstill/ui/blocks/code-id";
import { DataTable } from "@modelstill/ui/blocks/data-table";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { StatCard } from "@modelstill/ui/blocks/stat-card";

afterEach(cleanup);

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "alpha", score: 2 },
  { id: "b", name: "bravo", score: 3 },
  { id: "c", name: "charlie", score: 1 },
];

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "score", header: "Score", meta: { align: "right" } },
];

const names = () => screen.getAllByTestId("data-table-row").map((row) => row.getAttribute("data-row-id"));

describe("DataTable", () => {
  test("renders a row per item with a header per column", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} />);
    expect(names()).toEqual(["a", "b", "c"]);
    expect(screen.getByRole("columnheader", { name: /Score/ })).toBeTruthy();
  });

  test("clicking a sortable header sorts ascending then descending", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Score/ }));
    expect(names()).toEqual(["c", "a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: /Score/ }));
    expect(names()).toEqual(["b", "a", "c"]);
  });

  test("row selection reports the selected ids", () => {
    let selected: string[] = [];
    render(
      <DataTable columns={columns} data={rows} getRowId={(row) => row.id} enableRowSelection onSelectionChange={(ids) => (selected = ids)} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row b" }));
    expect(selected).toEqual(["b"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(selected.sort()).toEqual(["a", "b", "c"]);
  });

  test("a row click opens its detail in a side sheet", async () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        detail={{ title: (row) => `Run ${row.name}`, render: (row) => <p>detail for {row.name}</p> }}
      />,
    );
    fireEvent.click(screen.getAllByTestId("data-table-row")[1]!);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(within(screen.getByRole("dialog")).getByText("detail for bravo")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("Run bravo")).toBeTruthy();
  });

  test("onRowClick is called with the row", () => {
    const clicked: string[] = [];
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} onRowClick={(row) => clicked.push(row.id)} />);
    fireEvent.click(screen.getAllByTestId("data-table-row")[2]!);
    expect(clicked).toEqual(["c"]);
  });

  test("an empty table shows its empty message", () => {
    render(<DataTable columns={columns} data={[]} getRowId={(row) => row.id} emptyMessage="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });

  test("compact density marks the table", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} density="compact" />);
    expect(screen.getByRole("table").closest("[data-density]")?.getAttribute("data-density")).toBe("compact");
  });

  test("hidden columns are not rendered", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} initialColumnVisibility={{ score: false }} />);
    expect(screen.queryByRole("columnheader", { name: /Score/ })).toBeNull();
  });
});

describe("StatCard", () => {
  test("shows label, value and sublabel", () => {
    render(<StatCard label="Requests" value="12,400" sublabel="last 24 h" />);
    expect(screen.getByText("Requests")).toBeTruthy();
    expect(screen.getByText("12,400")).toBeTruthy();
    expect(screen.getByText("last 24 h")).toBeTruthy();
  });

  test("shows an interval and a trend when given", () => {
    render(<StatCard label="Accuracy" value="0.83" interval={{ low: 0.79, high: 0.86 }} trend={{ value: "+2.1%", direction: "up" }} />);
    expect(screen.getByText("[0.79, 0.86]")).toBeTruthy();
    expect(screen.getByText("+2.1%").closest("[data-slot=badge]")?.getAttribute("data-variant")).toBe("success");
  });

  test("a downward trend that is good uses the success tone", () => {
    render(<StatCard label="Errors" value="3" trend={{ value: "-40%", direction: "down", positive: "down" }} />);
    expect(screen.getByText("-40%").closest("[data-slot=badge]")?.getAttribute("data-variant")).toBe("success");
  });
});

describe("KeyValueList", () => {
  test("renders each label with its value", () => {
    render(<KeyValueList items={[{ label: "Mode", value: "serve" }, { label: "Threshold", value: "0.92" }]} />);
    const terms = screen.getAllByRole("term").map((node) => node.textContent);
    expect(terms).toEqual(["Mode", "Threshold"]);
    expect(screen.getByText("0.92")).toBeTruthy();
  });
});

describe("JsonView", () => {
  test("renders nested JSON with its keys", () => {
    render(<JsonView value={{ title: "Senior Engineer", tags: ["a"] }} />);
    expect(screen.getByText(/Senior Engineer/)).toBeTruthy();
    expect(screen.getByText(/"title"/)).toBeTruthy();
  });

  test("a primitive renders as-is", () => {
    render(<JsonView value={42} />);
    expect(screen.getByText("42")).toBeTruthy();
  });
});

describe("CodeId", () => {
  test("truncateId keeps the algorithm prefix and the head of the hash", () => {
    expect(truncateId("sha256:0123456789abcdef0123", 8)).toBe("sha256:01234567");
    expect(truncateId("0123456789abcdef", 8)).toBe("01234567");
    expect(truncateId("abc", 8)).toBe("abc");
  });

  test("shows the truncated id and keeps the full value as its title", () => {
    render(<CodeId value="sha256:0123456789abcdef0123" length={8} />);
    const code = screen.getByText("sha256:01234567");
    expect(code.closest("[title]")?.getAttribute("title")).toBe("sha256:0123456789abcdef0123");
  });

  test("copy writes the full value to the clipboard", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => written.push(text) }, configurable: true });
    render(<CodeId value="run-0123456789" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy run-0123456789" }));
    await waitFor(() => expect(written).toEqual(["run-0123456789"]));
  });

  test("a missing id shows n/a without a copy button", () => {
    render(<CodeId value={null} />);
    expect(screen.getByText("n/a")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
