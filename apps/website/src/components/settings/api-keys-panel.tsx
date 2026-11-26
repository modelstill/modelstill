"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRightIcon,
  BookOpenTextIcon,
  CalendarBlankIcon,
  ClockIcon,
  FunnelSimpleIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PulseIcon,
  ShieldCheckIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { CodeBlock } from "@modelstill/ui/blocks/code-block";
import { ErrorState } from "@modelstill/ui/blocks/states";
import { ChipList, HeaderLabel, NameCell, StatusPill, TablePager } from "@modelstill/ui/blocks/table-cells";
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
import { Button } from "@modelstill/ui/components/button";
import { Input } from "@modelstill/ui/components/input";
import { Checkbox } from "@modelstill/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { CopyButton } from "@/components/motion/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { Card, EmptyPanel, MetricRow, SectionLabel } from "@/components/dashboard/primitives";
import type { KeyPermission } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { curlSample, maskedKey, permissionScopes, type ApiKeyRow, type KeysApi } from "@/lib/keys";
import { DOCS_URL } from "@/lib/links";
import { CreateKeyDialog } from "./create-key-dialog";

type Listing = { status: "loading" } | { status: "error"; error: Error } | { status: "ready"; rows: ApiKeyRow[] };

function RevokeButton({ row, onRevoke }: { row: ApiKeyRow; onRevoke: (row: ApiKeyRow) => Promise<void> }) {
  const label = keyLabel(row);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Revoke ${label}`}
          className="shrink-0 px-2 text-muted-foreground hover:bg-transparent hover:text-negative"
        >
          <TrashIcon aria-hidden="true" className="size-3.5" />
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Anything that uses <span className="font-mono">{`${row.start ?? "ms_live_"}••••`}</span> gets a 401 from the next request. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => {
              void onRevoke(row);
            }}
          >
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function keyLabel(row: ApiKeyRow): string {
  return row.name ?? row.start ?? row.id;
}

function BulkRevokeBar({ rows, onRevoke, onClear }: { rows: ApiKeyRow[]; onRevoke: (rows: ApiKeyRow[]) => Promise<void>; onClear: () => void }) {
  const [pending, setPending] = useState(false);
  const noun = `${rows.length} ${rows.length === 1 ? "key" : "keys"}`;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <span className="type-label text-foreground tabular-nums">{rows.length} selected</span>
      <span className="flex-1" />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={pending} className="text-negative">
            <TrashIcon aria-hidden="true" data-icon="inline-start" />
            Revoke {noun}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything that uses {rows.map(keyLabel).join(", ")} gets a 401 from the next request. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setPending(true);
                void onRevoke(rows).finally(() => setPending(false));
              }}
            >
              Revoke {noun}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={pending} aria-label="Clear selection">
        <XIcon aria-hidden="true" data-icon="inline-start" />
        Clear
      </Button>
    </div>
  );
}

const PAGE_SIZE = 10;

type PermissionFilter = "all" | KeyPermission;

function KeysToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  onCreate,
}: {
  query: string;
  onQuery: (value: string) => void;
  filter: PermissionFilter;
  onFilter: (value: PermissionFilter) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-64">
        <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search keys..." aria-label="Search keys" className="h-8 pl-8 text-[13px]" />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FunnelSimpleIcon aria-hidden="true" data-icon="inline-start" />
            {filter === "all" ? "Filter" : filter === "read" ? "Read only" : "Read and write"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuLabel>Permission</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={filter} onValueChange={(value) => onFilter(value as PermissionFilter)}>
            <DropdownMenuRadioItem value="all">All keys</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="read">Read only</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="write">Read and write</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="flex-1" />
      <Button asChild variant="outline" size="sm">
        <a href={DOCS_URL} target="_blank" rel="noreferrer">
          <BookOpenTextIcon aria-hidden="true" data-icon="inline-start" />
          Docs
        </a>
      </Button>
      <Button size="sm" onClick={onCreate}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Create key
      </Button>
    </div>
  );
}

function KeysTable({
  rows,
  onRevoke,
  onRevokeMany,
}: {
  rows: ApiKeyRow[];
  onRevoke: (row: ApiKeyRow) => Promise<void>;
  onRevokeMany: (rows: ApiKeyRow[]) => Promise<string[]>;
}) {
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<string[]>([]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const selectedRows = rows.filter((row) => chosen.includes(row.id));
  const selected = selectedRows.map((row) => row.id);
  const onPage = shown.filter((row) => selected.includes(row.id)).length;
  const allChecked = shown.length > 0 && onPage === shown.length ? true : onPage > 0 ? "indeterminate" : false;
  const toggle = (id: string, on: boolean) => setChosen((ids) => (on ? [...ids, id] : ids.filter((entry) => entry !== id)));
  const togglePage = (on: boolean) => {
    const ids = shown.map((row) => row.id);
    setChosen((existing) => (on ? [...new Set([...existing, ...ids])] : existing.filter((id) => !ids.includes(id))));
  };
  const revokeSelected = async (targets: ApiKeyRow[]) => setChosen(await onRevokeMany(targets));
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" data-keys-table="">
      {selectedRows.length > 0 && <BulkRevokeBar rows={selectedRows} onRevoke={revokeSelected} onClear={() => setChosen([])} />}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pr-0 pl-4">
              <Checkbox
                aria-label="Select all keys"
                checked={allChecked}
                onCheckedChange={(value) => togglePage(value === true)}
              />
            </TableHead>
            <TableHead className="text-muted-foreground">
              <HeaderLabel icon={KeyIcon}>Key</HeaderLabel>
            </TableHead>
            <TableHead className="text-muted-foreground">
              <HeaderLabel icon={PulseIcon}>Status</HeaderLabel>
            </TableHead>
            <TableHead className="text-muted-foreground">
              <HeaderLabel icon={ShieldCheckIcon}>Permissions</HeaderLabel>
            </TableHead>
            <TableHead className="text-muted-foreground">
              <HeaderLabel icon={CalendarBlankIcon}>Created</HeaderLabel>
            </TableHead>
            <TableHead className="text-muted-foreground">
              <HeaderLabel icon={ClockIcon}>Last used</HeaderLabel>
            </TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.id} data-state={selected.includes(row.id) ? "selected" : undefined}>
              <TableCell className="w-10 pr-0 pl-4">
                <Checkbox aria-label={`Select ${row.name ?? row.id}`} checked={selected.includes(row.id)} onCheckedChange={(value) => toggle(row.id, value === true)} />
              </TableCell>
              <TableCell className="py-2.5">
                <NameCell icon={KeyIcon} name={row.name ?? "unnamed"} secondary={maskedKey(row.start)} />
              </TableCell>
              <TableCell>
                <StatusPill tone="success">Active</StatusPill>
              </TableCell>
              <TableCell>
                <ChipList items={permissionScopes(row.permission)} />
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground tabular-nums">{formatDateTime(row.createdAt)}</TableCell>
              <TableCell className="text-[13px] text-muted-foreground tabular-nums">{row.lastRequest ? formatDateTime(row.lastRequest) : "never"}</TableCell>
              <TableCell className="text-right">
                <RevokeButton row={row} onRevoke={onRevoke} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t border-border bg-surface-head px-4 py-2">
        <TablePager page={current} pageCount={pageCount} onPage={setPage} summary={`${rows.length} ${rows.length === 1 ? "key" : "keys"}`} />
      </div>
    </div>
  );
}

function BaseUrl({ apiUrl }: { apiUrl: string }) {
  return (
    <>
      <Card>
        <h2 className="type-title text-foreground">Base URL</h2>
        <div className="relative mt-2">
          <Input readOnly aria-label="API base URL" value={apiUrl} className="h-8 pr-10 font-mono text-[13px] text-muted-foreground" />
          <CopyButton
            content={apiUrl}
            variant="ghost"
            size="icon-sm"
            delay={2000}
            aria-label="Copy base URL"
            onCopyError={() => toast.error("Could not copy the URL")}
            className="absolute top-0.5 right-1 text-muted-foreground"
          />
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Every route lives under <span className="font-mono">/v1</span>. Send the key as <span className="font-mono">Authorization: Bearer</span> or{" "}
          <span className="font-mono">x-api-key</span>.
        </p>
      </Card>
      <Card className="mt-5">
        <h2 className="type-title text-foreground">Permissions</h2>
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <MetricRow label="Read key" value="Every GET route" hint="Tasks, evals, gates, training, traffic" />
          <MetricRow label="Write key" value="Reads and writes" hint="Push runs, gates, review items, deployments" />
          <MetricRow label="Prefix" value={<span className="font-mono">ms_live_</span>} hint="Shown once, stored hashed" />
        </div>
      </Card>
    </>
  );
}

export function ApiKeysPanel({ keys, apiUrl, owner = "You" }: { keys: KeysApi; apiUrl: string; owner?: string }) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PermissionFilter>("all");

  const reload = useCallback(() => {
    keys.list().then(
      (rows) => setListing({ status: "ready", rows }),
      (error: unknown) => setListing({ status: "error", error: error instanceof Error ? error : new Error(String(error)) }),
    );
  }, [keys]);

  useEffect(reload, [reload]);

  const create = async (name: string, permission: KeyPermission) => {
    const created = await keys.create(name, permission);
    reload();
    return created;
  };

  const revoke = async (row: ApiKeyRow) => {
    try {
      await keys.revoke(row.id);
      toast.success(`Revoked ${row.name ?? "the key"}`);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the key");
    }
  };

  const revokeMany = async (targets: ApiKeyRow[]) => {
    const failed: ApiKeyRow[] = [];
    for (const row of targets) {
      try {
        await keys.revoke(row.id);
      } catch {
        failed.push(row);
      }
    }
    const revoked = targets.length - failed.length;
    if (revoked > 0) toast.success(`Revoked ${revoked} ${revoked === 1 ? "key" : "keys"}`);
    if (failed.length > 0) toast.error(`Could not revoke ${failed.map(keyLabel).join(", ")}`);
    reload();
    return failed.map((row) => row.id);
  };

  const needle = query.trim().toLowerCase();
  const rows =
    listing.status === "ready"
      ? listing.rows.filter((row) => (filter === "all" || row.permission === filter) && `${row.name ?? ""} ${row.start ?? ""}`.toLowerCase().includes(needle))
      : [];

  return (
    <Tabs defaultValue="keys">
      <TabsList>
        <TabsTrigger value="keys" className="text-[13px]">
          Keys
        </TabsTrigger>
        <TabsTrigger value="base" className="text-[13px]">
          Base URL and permissions
        </TabsTrigger>
      </TabsList>

      <TabsContent value="keys" className="mt-5 flex flex-col gap-3">
        <KeysToolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} onCreate={() => setCreating(true)} />
        {listing.status === "loading" && <EmptyPanel>Loading keys...</EmptyPanel>}
        {listing.status === "error" && <ErrorState error={listing.error} onRetry={reload} />}
        {listing.status === "ready" &&
          (listing.rows.length === 0 ? <EmptyPanel>No API keys yet</EmptyPanel> : rows.length === 0 ? <EmptyPanel>No key matches the search.</EmptyPanel> : <KeysTable rows={rows} onRevoke={revoke} onRevokeMany={revokeMany} />)}
        <CreateKeyDialog open={creating} onOpenChange={setCreating} apiUrl={apiUrl} owner={owner} onCreate={create} />

        <div className="mt-3">
          <SectionLabel>Example request</SectionLabel>
          <CodeBlock label="curl" code={curlSample(apiUrl)} className="mt-2" />
        </div>

        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-link hover:underline">
          Read the API reference
          <ArrowUpRightIcon aria-hidden="true" className="size-4" />
        </a>
      </TabsContent>

      <TabsContent value="base" className="mt-5">
        <BaseUrl apiUrl={apiUrl} />
      </TabsContent>
    </Tabs>
  );
}
