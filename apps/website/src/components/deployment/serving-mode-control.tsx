"use client";

import { useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { KeyValueList } from "@modelstill/ui/blocks/key-value-list";
import { ModelName } from "@modelstill/ui/blocks/model-name";
import { Alert, AlertDescription } from "@modelstill/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modelstill/ui/components/alert-dialog";
import { Spinner } from "@modelstill/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import type { ApiClient, Deployment, Mode } from "@/lib/api";
import { modeUpdate, serveBlocker } from "@/lib/deployment";
import { formatShare } from "@/lib/interval";

const MODES: { value: Mode; hint: string }[] = [
  { value: "off", hint: "every call goes to the cloud model" },
  { value: "shadow", hint: "the student answers a sample on the side; callers get the cloud answer" },
  { value: "serve", hint: "confident student answers go to callers; the rest defer" },
];

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function ServingModeControl({
  slug,
  deployment,
  api,
  onSaved,
}: {
  slug: string;
  deployment: Deployment;
  api: Pick<ApiClient, "setDeployment">;
  onSaved: (deployment: Deployment) => void;
}) {
  const [pending, setPending] = useState<Mode | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocker = serveBlocker(deployment);
  const writable = modeUpdate(deployment, deployment.mode) !== null;

  async function save(mode: Mode) {
    const update = modeUpdate(deployment, mode);
    if (!update) return;
    setError(null);
    setPending(mode);
    try {
      const saved = await api.setDeployment(slug, update);
      onSaved(saved);
      toast.success(`Serving mode is now ${saved.mode}`);
    } catch (cause) {
      setError(`Mode not changed: ${errorText(cause)}`);
    } finally {
      setPending(null);
    }
  }

  function choose(value: string) {
    const mode = value as Mode;
    if (!value || mode === deployment.mode || pending) return;
    if (mode === "serve") setConfirming(true);
    else void save(mode);
  }

  const hint = MODES.find((entry) => entry.value === (pending ?? deployment.mode))?.hint;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" size="sm" variant="outline" value={pending ?? deployment.mode} onValueChange={choose} aria-label="Serving mode" disabled={!writable}>
          {MODES.map((entry) => (
            <ToggleGroupItem key={entry.value} value={entry.value} aria-label={entry.value} disabled={!writable || (entry.value === "serve" && blocker !== null)} className="px-3">
              {pending === entry.value && <Spinner />}
              {entry.value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {hint && <span className="type-body text-muted-foreground">{hint}</span>}
      </div>
      {blocker && <p className="type-body text-muted-foreground">{blocker}</p>}
      {!writable && <p className="type-body text-muted-foreground">This deployment has no target error, so push it again with the CLI before changing the mode here.</p>}
      {error && (
        <Alert variant="destructive">
          <WarningCircleIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <KeyValueList
        items={[
          { label: "Student model", value: <ModelName model={deployment.studentModel} /> },
          { label: "Confidence threshold", value: deployment.threshold ?? "n/a" },
          { label: "Shadow sample", value: formatShare(deployment.shadowSample) },
        ]}
      />
      <p className="type-body text-muted-foreground">The change is stored on the deployment record. The proxy picks this up within its reload interval.</p>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Serve {deployment.studentModel ?? "the student"} to callers?</AlertDialogTitle>
            <AlertDialogDescription>
              Calls where the student is at least {deployment.threshold ?? "n/a"} confident get its answer; the rest defer to the cloud model. The proxy picks this up
              within its reload interval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save("serve")}>Serve the student</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
