"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatabaseIcon } from "@phosphor-icons/react";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { Button } from "@modelstill/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@modelstill/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@modelstill/ui/components/field";
import { Input } from "@modelstill/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@modelstill/ui/components/select";
import { Skeleton } from "@modelstill/ui/components/skeleton";
import { Spinner } from "@modelstill/ui/components/spinner";
import { datasetNameError } from "@/components/datasets/dataset-dialogs";
import { ApiBodyError, type ServedRequest } from "@/lib/cases-api";
import { taskSectionHref } from "@/lib/nav";
import { caseFromRequest } from "@/lib/requests";
import { useCasesApi } from "@/lib/use-cases-api";

const NEW = "__new";

function failureText(error: unknown): string {
  if (error instanceof ApiBodyError && error.body && typeof error.body === "object" && "error" in error.body) {
    return String((error.body as { error: unknown }).error).replace(/_/g, " ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function AddToDatasetDialog({ request }: { request: ServedRequest }) {
  const cases = useCasesApi();
  const router = useRouter();
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [target, setTarget] = useState<string>(NEW);
  const [newName, setNewName] = useState("production");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const entry = caseFromRequest(request);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setNames(null);
    cases.listDatasets(request.task).then(
      (list) => {
        if (!live) return;
        const found = list.map((dataset) => dataset.name);
        setNames(found);
        setTarget(found[0] ?? NEW);
      },
      (error: unknown) => live && (setNames([]), setFailure(failureText(error))),
    );
    return () => {
      live = false;
    };
  }, [open, cases, request.task]);

  const creating = target === NEW;
  const nameError = creating ? datasetNameError(newName, names ?? []) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setFailure(null))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <DatabaseIcon aria-hidden="true" data-icon="inline-start" />
          Add to dataset
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add this request to a case dataset</DialogTitle>
          <DialogDescription>
            The case expects the cloud answer when there is one, else the student&apos;s. Its input holds the request hash, because the request itself is not stored; fill the input in on the dataset page before running evals on it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (nameError || names === null) return;
            setBusy(true);
            setFailure(null);
            try {
              const name = creating ? newName : target;
              const version = creating
                ? (await cases.createDataset(request.task, name, [entry])).version
                : (await cases.addRows(request.task, name, [entry], { source: "add" })).version;
              toast.success(`Added to ${name}`, {
                description: `The dataset is now at v${version.number}.`,
                action: { label: "Open dataset", onClick: () => router.push(taskSectionHref(request.task, "datasets")) },
              });
              setOpen(false);
            } catch (error) {
              setFailure(failureText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            {names === null ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Field>
                <FieldLabel>Dataset</FieldLabel>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger aria-label="Dataset" className="w-full">
                    <SelectValue>{creating ? "New dataset" : target}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {names.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW}>New dataset</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Datasets of the {request.task} task.</FieldDescription>
              </Field>
            )}
            {creating && (
              <Field data-invalid={nameError !== null || undefined}>
                <FieldLabel htmlFor={nameId}>New dataset name</FieldLabel>
                <Input id={nameId} value={newName} aria-invalid={nameError !== null || undefined} onChange={(event) => setNewName(event.target.value.trim())} />
                {nameError && <FieldError>{nameError}</FieldError>}
              </Field>
            )}
            <Field>
              <FieldLabel>Case</FieldLabel>
              <JsonView value={entry} maxHeight={220} />
            </Field>
            {failure && <FieldError>{failure}</FieldError>}
            <DialogFooter>
              <Button type="submit" disabled={busy || names === null || nameError !== null}>
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
