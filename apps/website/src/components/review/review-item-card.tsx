"use client";

import { useEffect, useId, useState } from "react";
import { CheckIcon, PencilSimpleLineIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { Section } from "@modelstill/ui/blocks/section";
import { TeacherDiff } from "@modelstill/ui/blocks/teacher-diff";
import { Alert, AlertDescription } from "@modelstill/ui/components/alert";
import { Button } from "@modelstill/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@modelstill/ui/components/field";
import { Spinner } from "@modelstill/ui/components/spinner";
import { Textarea } from "@modelstill/ui/components/textarea";
import { ReviewStateBadge } from "@/components/badges";
import type { ApiClient, ReviewDecision, ReviewItem } from "@/lib/api";

type Editing = { text: string } | null;

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function initialCorrection(item: ReviewItem): string {
  const first = item.teacherOutputs[0]?.output;
  return first === undefined ? "" : JSON.stringify(first, null, 2);
}

export function ReviewItemCard({
  item: initial,
  api,
  reviewer,
  onDecided,
}: {
  item: ReviewItem;
  api: Pick<ApiClient, "decideReviewItem">;
  reviewer: string;
  onDecided?: (item: ReviewItem) => void;
}) {
  const [item, setItem] = useState(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editorId = useId();

  useEffect(() => setItem(initial), [initial]);

  async function decide(decision: ReviewDecision, optimisticState: string) {
    const previous = item;
    setError(null);
    setPending(true);
    setItem({ ...item, reviewState: optimisticState });
    setEditing(null);
    try {
      const saved = await api.decideReviewItem(item.id, decision);
      const merged = { ...saved, teacherOutputs: saved.teacherOutputs.length ? saved.teacherOutputs : previous.teacherOutputs };
      setItem(merged);
      onDecided?.(merged);
      toast.success(`Decision saved: ${merged.reviewState}`);
    } catch (cause) {
      setItem(previous);
      setError(`Decision not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(false);
    }
  }

  function saveCorrection() {
    if (!editing) return;
    const parsed = parseJson(editing.text);
    if (!parsed.ok) {
      setError("The corrected output is not valid JSON.");
      return;
    }
    void decide({ verdict: "correct", correctedOutput: parsed.value, reviewer }, "corrected");
  }

  const noReviewer = reviewer.trim() === "";

  return (
    <div className="flex flex-col gap-4" data-testid="review-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CodeId value={item.inputHash} length={16} />
          <ReviewStateBadge state={item.reviewState} />
          <span className="text-xs text-muted-foreground">agreement {item.agreement === null ? "n/a" : item.agreement.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending || noReviewer} onClick={() => void decide({ verdict: "accept", reviewer }, "accepted")}>
            {pending ? <Spinner data-icon="inline-start" /> : <CheckIcon aria-hidden="true" data-icon="inline-start" />}
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || noReviewer}
            onClick={() => setEditing(editing ? null : { text: initialCorrection(item) })}
          >
            <PencilSimpleLineIcon aria-hidden="true" data-icon="inline-start" />
            Correct
          </Button>
        </div>
      </div>
      {noReviewer && <p className="text-xs text-muted-foreground">Enter your name as reviewer to record a decision.</p>}
      {error && (
        <Alert variant="destructive">
          <WarningCircleIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Section title="Input">
        <div data-testid="review-input">
          <JsonView value={item.input} />
        </div>
      </Section>
      <Section title="Teacher outputs" description="cells where the teachers disagree are highlighted">
        <TeacherDiff outputs={item.teacherOutputs} />
      </Section>
      {editing && (
        <Field>
          <FieldLabel htmlFor={editorId}>Corrected output (JSON)</FieldLabel>
          <Textarea
            id={editorId}
            value={editing.text}
            onChange={(event) => setEditing({ text: event.target.value })}
            className="min-h-40 font-mono text-xs"
            spellCheck={false}
          />
          <FieldDescription>Starts from the first teacher&apos;s answer. Must be valid JSON.</FieldDescription>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveCorrection} disabled={pending}>
              Save correction
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Field>
      )}
    </div>
  );
}
