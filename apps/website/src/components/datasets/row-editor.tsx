"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ClockCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@modelstill/ui/components/alert-dialog";
import { Badge } from "@modelstill/ui/components/badge";
import { Button } from "@modelstill/ui/components/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@modelstill/ui/components/field";
import { Skeleton } from "@modelstill/ui/components/skeleton";
import { Spinner } from "@modelstill/ui/components/spinner";
import { Textarea } from "@modelstill/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { Section } from "@modelstill/ui/blocks/section";
import type { CaseRow, RowEdit, RowRevision } from "@/lib/cases-api";
import { fieldText, parseFieldText, type FieldFormat } from "@/lib/dataset-edit";
import { formatDateTime } from "@/lib/format";

type FieldName = "input" | "expected" | "metadata";

const LABELS: Record<FieldName, string> = { input: "Input", expected: "Expected", metadata: "Metadata" };

function CaseField({
  name,
  value,
  readOnly,
  onValue,
}: {
  name: FieldName;
  value: unknown;
  readOnly: boolean;
  onValue: (value: unknown) => void;
}) {
  const id = useId();
  const initial = fieldText(value);
  const [format, setFormat] = useState<FieldFormat>(name === "metadata" ? "metadata" : initial.format);
  const [text, setText] = useState(initial.text);
  const [error, setError] = useState<string | null>(null);

  const apply = (nextText: string, nextFormat: FieldFormat) => {
    const parsed = parseFieldText(nextText, nextFormat);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    onValue(parsed.value);
  };

  return (
    <Field data-invalid={error !== null || undefined}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{LABELS[name]}</FieldLabel>
        {name !== "metadata" && !readOnly && (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={format}
            onValueChange={(next) => {
              if (!next) return;
              setFormat(next as FieldFormat);
              apply(text, next as FieldFormat);
            }}
            aria-label={`${LABELS[name]} format`}
          >
            <ToggleGroupItem value="text" className="h-6 px-2 text-[11px]">
              Text
            </ToggleGroupItem>
            <ToggleGroupItem value="json" className="h-6 px-2 text-[11px]">
              JSON
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      <Textarea
        id={id}
        value={text}
        readOnly={readOnly}
        aria-invalid={error !== null || undefined}
        spellCheck={format === "text"}
        className="min-h-20 font-mono text-[12px]"
        onChange={(event) => {
          setText(event.target.value);
          apply(event.target.value, format);
        }}
      />
      {error !== null ? <FieldError>{error}</FieldError> : name === "metadata" && <FieldDescription>A JSON object. A list of strings under tags becomes the case tags.</FieldDescription>}
    </Field>
  );
}

function changeLabel(revision: RowRevision, previous: RowRevision | undefined): string {
  if (revision.deleted) return "deleted";
  if (!previous || previous.deleted) return previous ? "restored" : "created";
  const changed = (["input", "expected", "metadata"] as const).filter(
    (field) => JSON.stringify(revision[field]) !== JSON.stringify(previous[field]),
  );
  if (changed.length === 0) return "saved unchanged";
  return `${changed.join(" and ")} changed`;
}

function History({ load, reloadKey }: { load: () => Promise<RowRevision[]>; reloadKey: number }) {
  const [revisions, setRevisions] = useState<RowRevision[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let live = true;
    latest.current().then(
      (loaded) => live && setRevisions(loaded),
      (error: unknown) => live && setFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [reloadKey]);

  if (failed) return <p className="text-[12px] text-muted-foreground">Could not load the history: {failed}</p>;
  if (!revisions) return <Skeleton className="h-16 w-full" />;
  return (
    <ol className="flex flex-col gap-1.5" data-testid="row-history">
      {revisions.map((revision, index) => (
        <li key={revision.version} className="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge variant="outline" className="font-mono">
            v{revision.version}
          </Badge>
          <span className="text-foreground">{changeLabel(revision, revisions[index + 1])}</span>
          <span className="text-muted-foreground">
            {revision.author ?? "unknown"}, {formatDateTime(revision.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DeleteCase({ rowId, onDelete }: { rowId: string; onDelete: (rowId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <TrashIcon aria-hidden="true" data-icon="inline-start" />
          Delete case
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete case {rowId}?</AlertDialogTitle>
          <AlertDialogDescription>
            This writes a new dataset version without the case. Earlier versions still hold it, and its history stays readable.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete(rowId);
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RowEditor({
  row,
  readOnly,
  onChange,
  onDelete,
  loadHistory,
  historyKey,
}: {
  row: CaseRow;
  readOnly: boolean;
  onChange: (rowId: string, patch: RowEdit) => void;
  onDelete: (rowId: string) => Promise<void>;
  loadHistory: () => Promise<RowRevision[]>;
  historyKey: number;
}) {
  return (
    <>
      <FieldGroup>
        {(["input", "expected", "metadata"] as const).map((name) => (
          <CaseField
            key={name}
            name={name}
            value={row[name]}
            readOnly={readOnly}
            onValue={(value) => onChange(row.id, { [name]: value } as RowEdit)}
          />
        ))}
      </FieldGroup>
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <ClockCounterClockwiseIcon aria-hidden="true" />
            Change history
          </span>
        }
      >
        <History load={loadHistory} reloadKey={historyKey} />
      </Section>
      {!readOnly && (
        <div className="flex justify-end">
          <DeleteCase rowId={row.id} onDelete={onDelete} />
        </div>
      )}
    </>
  );
}
