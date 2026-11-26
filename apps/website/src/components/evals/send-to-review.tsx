"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleNotchIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { cn } from "@modelstill/ui/lib/utils";
import type { ComparedCase } from "@/lib/api";
import { reviewCandidate } from "@/lib/flow";
import { taskSectionHref } from "@/lib/nav";
import { useApiClient } from "@/lib/use-api";
import { HEADER_BUTTON } from "@/components/dashboard/header-link";

function runLabel(run: unknown): { model: string } | null {
  if (run && typeof run === "object" && "model" in run && typeof (run as { model: unknown }).model === "string") {
    return { model: (run as { model: string }).model };
  }
  return null;
}

export type SendToReview = { send: (inputHashes: string[]) => Promise<void>; sending: boolean };

export function useSendToReview({
  slug,
  beforeRun,
  afterRun,
  loadCase,
}: {
  slug: string;
  beforeRun: unknown;
  afterRun: unknown;
  loadCase: (inputHash: string) => Promise<ComparedCase>;
}): SendToReview {
  const api = useApiClient();
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const send = useCallback(
    async (inputHashes: string[]) => {
      if (inputHashes.length === 0) return;
      setSending(true);
      try {
        const details = await Promise.all(inputHashes.map((hash) => loadCase(hash)));
        const queued = await api.sendToReview(
          slug,
          details.map((detail) => reviewCandidate(detail, runLabel(beforeRun), runLabel(afterRun))),
        );
        toast.success(`${queued} ${queued === 1 ? "case" : "cases"} in the review queue`, {
          description: "A reviewer picks the right answer; it then joins the dataset.",
          action: { label: "Open queue", onClick: () => router.push(taskSectionHref(slug, "review")) },
        });
      } catch (error) {
        toast.error("Could not send to review", { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setSending(false);
      }
    },
    [api, slug, loadCase, beforeRun, afterRun, router],
  );
  return { send, sending };
}

export function SendToReviewButton({
  count,
  sending,
  onClick,
  label,
  primary = false,
  className,
}: {
  count: number;
  sending: boolean;
  onClick: () => void;
  label?: string;
  primary?: boolean;
  className?: string;
}) {
  return (
    <Button size="sm" variant={primary ? "default" : "outline"} disabled={count === 0 || sending} onClick={onClick} className={cn(HEADER_BUTTON, className)}>
      {sending ? <CircleNotchIcon aria-hidden="true" className="animate-spin" /> : <PaperPlaneTiltIcon aria-hidden="true" />}
      {label ?? `Send ${count} to review`}
    </Button>
  );
}
