"use client";

import { useMemo, useState, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, CaretUpDownIcon, ColumnsIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { Checkbox } from "@modelstill/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@modelstill/ui/components/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { cn } from "@modelstill/ui/lib/utils";
import { HeaderLabel } from "./table-cells";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    label?: string;
    icon?: ComponentType<{ className?: string }>;
    className?: string;
    headerClassName?: string;
  }
}

export type DataTableDensity = "compact" | "default";

export type DataTableDetail<T> = {
  title: (row: T) => ReactNode;
  description?: (row: T) => ReactNode;
  render: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  columns: ColumnDef<T, never>[] | ColumnDef<T>[];
  data: T[];
  getRowId: (row: T) => string;
  density?: DataTableDensity;
  enableRowSelection?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onRowClick?: (row: T) => void;
  detail?: DataTableDetail<T>;
  toolbar?: ReactNode;
  columnToggle?: boolean;
  initialSorting?: SortingState;
  initialColumnVisibility?: VisibilityState;
  emptyMessage?: ReactNode;
  maxHeight?: CSSProperties["maxHeight"];
  footer?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  rowAttributes?: (row: T) => Record<string, string | undefined>;
  className?: string;
};

function columnLabel<T>(column: Column<T, unknown>): string {
  const header = column.columnDef.header;
  return column.columnDef.meta?.label ?? (typeof header === "string" ? header : column.id);
}

function SortableHeader<T>({ column, label }: { column: Column<T, unknown>; label: ReactNode }) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : CaretUpDownIcon;
  const right = column.columnDef.meta?.align === "right";
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={column.getToggleSortingHandler()}
      className={cn("-mx-1.5 font-normal text-muted-foreground hover:text-foreground", right && "flex-row-reverse", sorted && "text-foreground")}
    >
      {label}
      <Icon aria-hidden="true" data-icon={right ? "inline-start" : "inline-end"} className={cn(!sorted && "opacity-50")} />
    </Button>
  );
}

function selectionColumn<T>(): ColumnDef<T> {
  return {
    id: "__select",
    enableSorting: false,
    enableHiding: false,
    meta: { className: "w-8 pr-0", headerClassName: "w-8 pr-0" },
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows"
        checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
        onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select row ${row.id}`}
        checked={row.getIsSelected()}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(value) => row.toggleSelected(value === true)}
      />
    ),
  };
}

function idsFrom(state: RowSelectionState): string[] {
  return Object.entries(state)
    .filter(([, on]) => on)
    .map(([id]) => id);
}

function stateFrom(ids: readonly string[]): RowSelectionState {
  return Object.fromEntries(ids.map((id) => [id, true]));
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  density = "compact",
  enableRowSelection = false,
  selectedIds,
  onSelectionChange,
  onRowClick,
  detail,
  toolbar,
  columnToggle = false,
  initialSorting = [],
  initialColumnVisibility = {},
  emptyMessage = "No rows.",
  maxHeight,
  footer,
  rowClassName,
  rowAttributes,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialColumnVisibility);
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const rowSelection = selectedIds ? stateFrom(selectedIds) : ownSelection;
  const onRowSelectionChange = (updater: Updater<RowSelectionState>) => {
    const next = typeof updater === "function" ? updater(rowSelection) : updater;
    if (!selectedIds) setOwnSelection(next);
    onSelectionChange?.(idsFrom(next));
  };

  const allColumns = useMemo(
    () => (enableRowSelection ? [selectionColumn<T>(), ...(columns as ColumnDef<T>[])] : (columns as ColumnDef<T>[])),
    [columns, enableRowSelection],
  );

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    state: { sorting, columnVisibility, rowSelection },
    enableRowSelection,
    sortDescFirst: false,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const clickable = Boolean(onRowClick || detail);
  const activeRow = activeId === null ? undefined : data.find((row) => getRowId(row) === activeId);
  const openRow = (row: T) => {
    onRowClick?.(row);
    if (detail) setActiveId(getRowId(row));
  };
  const onRowKey = (event: KeyboardEvent, row: T) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRow(row);
    }
  };

  const cellPad = density === "compact" ? "px-4 py-1" : "px-4 py-1.5";
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const visibleCount = table.getVisibleLeafColumns().length;

  return (
    <div data-slot="data-table" data-density={density} className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card", className)}>
      {(toolbar || columnToggle) && (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {columnToggle && hideable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  <ColumnsIcon aria-hidden="true" data-icon="inline-start" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {hideable.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(value === true)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {columnLabel(column)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <Table containerClassName={cn(maxHeight !== undefined && "overflow-auto")} containerStyle={maxHeight !== undefined ? { maxHeight } : undefined}>
        <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const rendered = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                const content = meta?.icon && rendered ? <HeaderLabel icon={meta.icon}>{rendered}</HeaderLabel> : rendered;
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined
                    }
                    className={cn(
                      "px-4 py-0",
                      meta?.align === "right" && "text-right",
                      meta?.headerClassName,
                    )}
                  >
                    {header.column.getCanSort() && typeof header.column.columnDef.header === "string" ? (
                      <SortableHeader column={header.column} label={content} />
                    ) : (
                      content
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={visibleCount} className="h-20 px-3 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="data-table-row"
                data-row-id={row.id}
                data-state={row.getIsSelected() || row.id === activeId ? "selected" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => openRow(row.original) : undefined}
                onKeyDown={clickable ? (event) => onRowKey(event, row.original) : undefined}
                className={cn(clickable && "cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none", rowClassName?.(row.original))}
                {...rowAttributes?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <TableCell key={cell.id} className={cn(cellPad, meta?.align === "right" && "text-right", meta?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {footer && <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 border-t border-border bg-sidebar/60 px-4 py-2 text-[13px] tabular-nums text-muted-foreground">{footer}</div>}
      {detail && (
        <Sheet open={activeRow !== undefined} onOpenChange={(open) => !open && setActiveId(null)}>
          <SheetContent className="w-full gap-0 sm:max-w-xl">
            {activeRow !== undefined && (
              <>
                <SheetHeader className="border-b">
                  <SheetTitle>{detail.title(activeRow)}</SheetTitle>
                  <SheetDescription className={cn(!detail.description && "sr-only")}>
                    {detail.description ? detail.description(activeRow) : "Row details"}
                  </SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{detail.render(activeRow)}</div>
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
