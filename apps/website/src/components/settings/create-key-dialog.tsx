"use client";

import { useId, useState, type FormEvent } from "react";
import { InfoIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ApiCallBlock } from "@modelstill/ui/blocks/code-panel";
import { SpecTable } from "@modelstill/ui/blocks/detail-header";
import { StepList } from "@modelstill/ui/blocks/step-list";
import { ChipList } from "@modelstill/ui/blocks/table-cells";
import { Button } from "@modelstill/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@modelstill/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@modelstill/ui/components/field";
import { Input } from "@modelstill/ui/components/input";
import { Spinner } from "@modelstill/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { stepStates } from "@modelstill/ui/lib/steps";
import { CopyButton } from "@/components/motion/copy-button";
import type { CreatedApiKey, KeyPermission } from "@/lib/api";
import { createKeyCurl, permissionScopes } from "@/lib/keys";
import { API_KEY_ENV } from "@/lib/mcp";

const KEY_NAME_MAX = 32;
const STEPS = [
  { key: "detail", label: "Detail", title: "Detail", description: "Name the key and choose what it may do." },
  { key: "review", label: "Review", title: "Review", description: "Check the key before it is generated." },
  { key: "secret", label: "Secret key", title: "Secret key", description: "Copy the key now. It is stored hashed." },
] as const;

export function CreateKeyDialog({
  open,
  onOpenChange,
  apiUrl,
  owner,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiUrl: string;
  owner: string;
  onCreate: (name: string, permission: KeyPermission) => Promise<CreatedApiKey>;
}) {
  const nameId = useId();
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<KeyPermission>("read");
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const trimmed = name.trim();
  const states = stepStates(STEPS.length, index);
  const step = STEPS[index]!;

  const reset = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setIndex(0);
      setName("");
      setPermission("read");
      setCreated(null);
    }
  };

  const generate = async () => {
    setPending(true);
    try {
      setCreated(await onCreate(trimmed, permission));
      setIndex(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the key");
    } finally {
      setPending(false);
    }
  };

  const submitDetail = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) setIndex(1);
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[880px]" showCloseButton={false}>
        <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-3 border-b border-border bg-surface-head p-4 md:border-r md:border-b-0">
            <DialogTitle className="px-2.5 pt-1 text-[14px] font-medium">Create API key</DialogTitle>
            <StepList
              steps={STEPS.map((entry, position) => ({ key: entry.key, label: entry.label, state: states[position]! }))}
              onSelect={(key) => !created && setIndex(STEPS.findIndex((entry) => entry.key === key))}
            />
            <p className="mt-auto flex items-start gap-2 rounded-lg bg-card px-3 py-2.5 text-[12px] leading-4 text-muted-foreground ring-1 ring-border">
              <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              Keys start with ms_live_ and can be revoked any time.
            </p>
          </aside>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-col gap-1 px-6 pt-5 pb-4">
              <h3 className="type-title text-foreground">{step.title}</h3>
              <DialogDescription className="text-[13px]">{step.description}</DialogDescription>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5">
              {index === 0 && (
                <form id="key-detail" onSubmit={submitDetail}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={nameId}>Key name</FieldLabel>
                      <Input id={nameId} value={name} maxLength={KEY_NAME_MAX} autoComplete="off" placeholder="laptop, ci, training-box" onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Permission</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={permission}
                        onValueChange={(value) => value && setPermission(value as KeyPermission)}
                        aria-label="Permission"
                        className="w-fit"
                      >
                        <ToggleGroupItem value="read" className="px-3">
                          Read only
                        </ToggleGroupItem>
                        <ToggleGroupItem value="write" className="px-3">
                          Read and write
                        </ToggleGroupItem>
                      </ToggleGroup>
                      <FieldDescription>A read key can call every GET route. A write key can also push results, review items and deployments.</FieldDescription>
                    </Field>
                  </FieldGroup>
                </form>
              )}
              {index === 1 && (
                <>
                  <SpecTable
                    rows={[
                      { label: "Name", value: trimmed },
                      { label: "Owner", value: owner },
                      { label: "Permissions", value: <ChipList items={permissionScopes(permission)} /> },
                      { label: "Prefix", value: <span className="font-mono text-[12.5px]">ms_live_</span> },
                      { label: "Expiry", value: "Never" },
                      { label: "Storage", value: "Hashed; shown once" },
                    ]}
                  />
                  <ApiCallBlock icon={<TerminalWindowIcon className="size-4 text-muted-foreground" />} method="POST" path="/v1/api-keys" code={createKeyCurl(apiUrl, trimmed, permission)} />
                </>
              )}
              {index === 2 && created && (
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-head p-4">
                  <p className="text-[13px] font-medium text-foreground">Copy {created.name ?? "your key"} now</p>
                  <div className="flex items-center gap-2">
                    <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-border bg-background px-3 font-mono text-[13px] whitespace-nowrap text-foreground">
                      {created.key}
                    </code>
                    <CopyButton content={created.key} label="Copy" delay={2000} aria-label="Copy new key" onCopyError={() => toast.error("Could not copy the key")} className="h-9 w-auto gap-1.5 px-4" />
                  </div>
                  <p className="text-[12px] text-warning">It will not be shown again. Store it in a secret manager or as {API_KEY_ENV}.</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border px-6 py-4">
              {index < 2 ? (
                <>
                  <Button type="button" variant="ghost" onClick={() => (index === 0 ? reset(false) : setIndex(0))}>
                    {index === 0 ? "Cancel" : "Back"}
                  </Button>
                  {index === 0 ? (
                    <Button type="submit" form="key-detail" disabled={!trimmed}>
                      Continue
                    </Button>
                  ) : (
                    <Button type="button" onClick={() => void generate()} disabled={pending}>
                      {pending && <Spinner data-icon="inline-start" />}
                      Generate key
                    </Button>
                  )}
                </>
              ) : (
                <Button type="button" className="col-span-2" onClick={() => reset(false)}>
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
