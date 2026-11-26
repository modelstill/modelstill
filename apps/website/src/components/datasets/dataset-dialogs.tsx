"use client";

import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FilePlusIcon, PlusIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { Checkbox } from "@modelstill/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@modelstill/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@modelstill/ui/components/field";
import { Input } from "@modelstill/ui/components/input";
import { Spinner } from "@modelstill/ui/components/spinner";
import { Textarea } from "@modelstill/ui/components/textarea";
import { HEADER_BUTTON } from "@/components/dashboard/header-link";
import { ApiBodyError, type NewCase } from "@/lib/cases-api";
import { parseFieldText } from "@/lib/dataset-edit";
import { serverRowErrors, type RowError } from "@/lib/dataset-import";
import { ImportPanel } from "./import-panel";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function datasetNameError(name: string, taken: readonly string[]): string | null {
  if (!name) return "give the dataset a name";
  if (!NAME_PATTERN.test(name)) return "use up to 64 letters, digits, dots, dashes and underscores";
  if (taken.includes(name)) return "a dataset with this name exists";
  return null;
}

function message(error: unknown): string {
  if (error instanceof ApiBodyError && error.body && typeof error.body === "object" && "error" in error.body) {
    const code = String((error.body as { error: unknown }).error);
    if (code === "version_conflict") return "the dataset changed meanwhile; reload it and try again";
    if (code === "dataset_exists") return "a dataset with this name exists";
    return code.replace(/_/g, " ");
  }
  return error instanceof Error ? error.message : String(error);
}

function NameField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error: string | null }) {
  const id = useId();
  return (
    <Field data-invalid={(value !== "" && error !== null) || undefined}>
      <FieldLabel htmlFor={id}>Dataset name</FieldLabel>
      <Input id={id} value={value} placeholder="gold" autoComplete="off" aria-invalid={(value !== "" && error !== null) || undefined} onChange={(event) => onChange(event.target.value.trim())} />
      {value !== "" && error ? <FieldError>{error}</FieldError> : <FieldDescription>Letters, digits, dots, dashes and underscores.</FieldDescription>}
    </Field>
  );
}

export function NewDatasetDialog({
  taken,
  onCreate,
  trigger,
}: {
  taken: readonly string[];
  onCreate: (name: string) => Promise<void>;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const error = datasetNameError(name, taken);
  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setFailure(null))}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className={HEADER_BUTTON}>
            <FilePlusIcon aria-hidden="true" data-icon="inline-start" />
            New dataset
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New case dataset</DialogTitle>
          <DialogDescription>It starts empty at version 1. Add rows by hand or import a file.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (error) return;
            setBusy(true);
            try {
              await onCreate(name);
              setOpen(false);
              setName("");
            } catch (caught) {
              setFailure(message(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <NameField value={name} onChange={setName} error={error} />
            {failure && <FieldError>{failure}</FieldError>}
            <DialogFooter>
              <Button type="submit" disabled={error !== null || busy}>
                {busy && <Spinner data-icon="inline-start" />}
                Create dataset
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  description,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  description?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field data-invalid={error !== null || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== null || undefined}
        className="min-h-16 font-mono text-[12px]"
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <FieldError>{error}</FieldError> : description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

export function buildManualCase(fields: { id: string; input: string; expected: string; metadata: string; json: boolean }):
  | { ok: true; value: NewCase }
  | { ok: false; errors: Partial<Record<"input" | "expected" | "metadata", string>> } {
  const format = fields.json ? "json" : "text";
  const errors: Partial<Record<"input" | "expected" | "metadata", string>> = {};
  const input = fields.input.trim() === "" ? null : parseFieldText(fields.input, format);
  if (input === null) errors.input = "every case needs an input";
  else if (!input.ok) errors.input = input.message;
  const expected = fields.expected.trim() === "" ? null : parseFieldText(fields.expected, format);
  if (expected && !expected.ok) errors.expected = expected.message;
  const metadata = parseFieldText(fields.metadata.trim() === "" ? "{}" : fields.metadata, "metadata");
  if (!metadata.ok) errors.metadata = metadata.message;
  if (Object.keys(errors).length > 0 || !input?.ok || !metadata.ok) return { ok: false, errors };
  const value: NewCase = { input: input.value, metadata: metadata.value as Record<string, unknown> };
  if (fields.id.trim()) value.id = fields.id.trim();
  if (expected?.ok) value.expected = expected.value;
  return { ok: true, value };
}

export function AddRowDialog({ disabled, onAdd }: { disabled: boolean; onAdd: (entry: NewCase) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ id: "", input: "", expected: "", metadata: "{}", json: false });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const jsonId = useId();
  const idId = useId();
  const built = buildManualCase(fields);
  const errors = touched && !built.ok ? built.errors : {};
  const set = (key: keyof typeof fields) => (value: string | boolean) => setFields((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setFailure(null), setTouched(false))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={HEADER_BUTTON} disabled={disabled}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          Add row
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add a case</DialogTitle>
          <DialogDescription>Saving writes a new dataset version with this case at the end.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setTouched(true);
            if (!built.ok) return;
            setBusy(true);
            try {
              await onAdd(built.value);
              setOpen(false);
              setFields({ id: "", input: "", expected: "", metadata: "{}", json: false });
              setTouched(false);
            } catch (caught) {
              setFailure(message(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={idId}>Case id</FieldLabel>
              <Input id={idId} value={fields.id} placeholder="made for you when empty" autoComplete="off" onChange={(event) => set("id")(event.target.value)} />
            </Field>
            <TextField label="Input" value={fields.input} onChange={set("input")} error={errors.input ?? null} />
            <TextField label="Expected" value={fields.expected} onChange={set("expected")} error={errors.expected ?? null} description="Leave empty when the case has no reference answer." />
            <Field orientation="horizontal">
              <Checkbox id={jsonId} checked={fields.json} onCheckedChange={(value) => set("json")(value === true)} />
              <FieldLabel htmlFor={jsonId} className="font-normal">
                Input and expected are JSON
              </FieldLabel>
            </Field>
            <TextField label="Metadata" value={fields.metadata} onChange={set("metadata")} error={errors.metadata ?? null} description='A JSON object. {"tags": ["hard"]} sets the case tags.' />
            {failure && <FieldError>{failure}</FieldError>}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                Add case
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ImportDialog({
  existingIds,
  taken,
  needsName,
  disabled,
  onImport,
  trigger,
}: {
  existingIds: ReadonlySet<string>;
  taken: readonly string[];
  needsName: boolean;
  disabled?: boolean;
  onImport: (cases: NewCase[], name: string | null) => Promise<{ count: number; version: number }>;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [serverErrors, setServerErrors] = useState<RowError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const nameError = needsName ? datasetNameError(name, taken) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setServerErrors([]);
        setFailure(null);
        if (next) setAttempt((count) => count + 1);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className={HEADER_BUTTON} disabled={disabled}>
            <UploadSimpleIcon aria-hidden="true" data-icon="inline-start" />
            Import
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import cases</DialogTitle>
          <DialogDescription>
            Choose what each file column becomes, check the first rows, then import. The import is one new dataset version; nothing already in the dataset changes.
          </DialogDescription>
        </DialogHeader>
        {needsName && (
          <FieldGroup>
            <NameField value={name} onChange={setName} error={nameError} />
          </FieldGroup>
        )}
        {failure && <FieldError>{failure}</FieldError>}
        <ImportPanel
          key={attempt}
          existingIds={existingIds}
          serverErrors={serverErrors}
          blockedReason={needsName && nameError ? "name the dataset first" : null}
          onImport={async (cases) => {
            setServerErrors([]);
            setFailure(null);
            try {
              const result = await onImport(cases, needsName ? name : null);
              toast.success(`Imported ${result.count} ${result.count === 1 ? "case" : "cases"}`, { description: `The dataset is now at v${result.version}.` });
              setOpen(false);
              setName("");
            } catch (caught) {
              const rows = caught instanceof ApiBodyError ? serverRowErrors(caught.body) : [];
              if (rows.length > 0) setServerErrors(rows);
              else setFailure(message(caught));
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
