"use client";

import { useId, useMemo, useState } from "react";
import { UploadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@modelstill/ui/components/alert";
import { Button } from "@modelstill/ui/components/button";
import { Checkbox } from "@modelstill/ui/components/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@modelstill/ui/components/field";
import { Input } from "@modelstill/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@modelstill/ui/components/select";
import { Spinner } from "@modelstill/ui/components/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import type { NewCase } from "@/lib/cases-api";
import {
  CASE_FIELDS,
  buildCases,
  fileKind,
  guessMapping,
  parseImportFile,
  type CaseField,
  type Mapping,
  type ParsedFile,
  type RowError,
} from "@/lib/dataset-import";

const PREVIEW_ROWS = 5;
const SHOWN_ERRORS = 50;

type Loaded = { name: string; parsed: ParsedFile; kind: "csv" | "jsonl" };

function preview(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function fieldLabel(field: CaseField): string {
  return CASE_FIELDS.find((option) => option.value === field)?.label ?? field;
}

function MappingTable({ loaded, mapping, onChange }: { loaded: Loaded; mapping: Mapping; onChange: (column: string, field: CaseField) => void }) {
  const sample = loaded.parsed.rows[0] ?? {};
  return (
    <Table containerClassName="rounded-md border">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="px-3">File column</TableHead>
          <TableHead className="px-3">First value</TableHead>
          <TableHead className="px-3">Imports as</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loaded.parsed.columns.map((column) => (
          <TableRow key={column} className="hover:bg-transparent">
            <TableCell className="px-3 py-1 font-mono text-[12px]">{column}</TableCell>
            <TableCell className="max-w-[220px] truncate px-3 py-1 font-mono text-[12px] text-muted-foreground">{preview(sample[column])}</TableCell>
            <TableCell className="px-3 py-1">
              <Select value={mapping[column]} onValueChange={(value) => onChange(column, value as CaseField)}>
                <SelectTrigger size="sm" className="w-40" aria-label={`Import ${column} as`} data-testid={`mapping-${column}`}>
                  <SelectValue>{fieldLabel(mapping[column] ?? "skip")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CASE_FIELDS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PreviewTable({ cases }: { cases: NewCase[] }) {
  return (
    <Table containerClassName="rounded-md border">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 px-3 text-right">Row</TableHead>
          <TableHead className="px-3">Case id</TableHead>
          <TableHead className="px-3">Input</TableHead>
          <TableHead className="px-3">Expected</TableHead>
          <TableHead className="px-3">Metadata</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cases.slice(0, PREVIEW_ROWS).map((entry, index) => (
          <TableRow key={index} data-testid="preview-row" className="hover:bg-transparent">
            <TableCell className="px-3 py-1 text-right tabular-nums text-muted-foreground">{index + 1}</TableCell>
            <TableCell className="px-3 py-1 font-mono text-[12px]">{entry.id ?? <span className="text-muted-foreground">new</span>}</TableCell>
            <TableCell className="max-w-[200px] truncate px-3 py-1 font-mono text-[12px]">{preview(entry.input)}</TableCell>
            <TableCell className="max-w-[160px] truncate px-3 py-1 font-mono text-[12px]">{preview(entry.expected)}</TableCell>
            <TableCell className="max-w-[160px] truncate px-3 py-1 font-mono text-[12px] text-muted-foreground">
              {entry.metadata && Object.keys(entry.metadata).length > 0 ? preview(entry.metadata) : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ErrorList({ errors }: { errors: RowError[] }) {
  return (
    <Alert variant="destructive">
      <WarningCircleIcon aria-hidden="true" />
      <AlertTitle>
        {errors.length} {errors.length === 1 ? "problem" : "problems"} to fix before importing
      </AlertTitle>
      <AlertDescription>
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {errors.slice(0, SHOWN_ERRORS).map((error, index) => (
            <li key={index}>{error.row > 0 ? `Row ${error.row}: ${error.message}` : error.message}</li>
          ))}
          {errors.length > SHOWN_ERRORS && <li>and {errors.length - SHOWN_ERRORS} more</li>}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function ImportPanel({
  existingIds,
  onImport,
  serverErrors = [],
  blockedReason,
}: {
  existingIds: ReadonlySet<string>;
  onImport: (cases: NewCase[]) => Promise<void>;
  serverErrors?: RowError[];
  blockedReason?: string | null;
}) {
  const fileId = useId();
  const jsonId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [parseJson, setParseJson] = useState(true);
  const [busy, setBusy] = useState(false);

  const built = useMemo(
    () => (loaded ? buildCases(loaded.parsed.rows, mapping, { parseJson: loaded.kind === "csv" && parseJson, existingIds }) : null),
    [loaded, mapping, parseJson, existingIds],
  );
  const fileErrors: RowError[] = loaded ? loaded.parsed.errors.map((error) => ({ ...error, field: "file" as const })) : [];
  const errors = [...fileErrors, ...(built?.errors ?? []), ...serverErrors];
  const count = built?.cases.length ?? 0;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const kind = fileKind(file.name);
    const parsed = parseImportFile(file.name, await file.text());
    setLoaded({ name: file.name, parsed, kind: kind ?? "csv" });
    setMapping(guessMapping(parsed.columns));
  };

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={fileId}>File</FieldLabel>
        <Input id={fileId} type="file" accept=".csv,.jsonl,.ndjson,text/csv,application/x-ndjson" onChange={(event) => void choose(event.target.files?.[0])} />
        <FieldDescription>
          {loaded
            ? `${loaded.parsed.rows.length} rows and ${loaded.parsed.columns.length} columns read from ${loaded.name}`
            : "A CSV file with a header row, or JSONL with one object per line."}
        </FieldDescription>
      </Field>
      {loaded && loaded.parsed.columns.length > 0 && (
        <>
          <MappingTable loaded={loaded} mapping={mapping} onChange={(column, field) => setMapping((current) => ({ ...current, [column]: field }))} />
          {loaded.kind === "csv" && (
            <Field orientation="horizontal">
              <Checkbox id={jsonId} checked={parseJson} onCheckedChange={(value) => setParseJson(value === true)} />
              <FieldLabel htmlFor={jsonId} className="font-normal">
                Read JSON inside cells, so 3 stays a number and [&quot;a&quot;] a list
              </FieldLabel>
            </Field>
          )}
          {built && built.cases.length > 0 && <PreviewTable cases={built.cases} />}
        </>
      )}
      {errors.length > 0 && <ErrorList errors={errors} />}
      <div className="flex items-center justify-end gap-2">
        {blockedReason && <span className="text-[12px] text-muted-foreground">{blockedReason}</span>}
        <Button
          disabled={!loaded || count === 0 || errors.length > 0 || busy || Boolean(blockedReason)}
          onClick={async () => {
            if (!built) return;
            setBusy(true);
            try {
              await onImport(built.cases);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner data-icon="inline-start" /> : <UploadSimpleIcon aria-hidden="true" data-icon="inline-start" />}
          Import {count} {count === 1 ? "case" : "cases"}
        </Button>
      </div>
    </FieldGroup>
  );
}
