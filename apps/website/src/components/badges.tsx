import { ArrowDownIcon, ArrowsLeftRightIcon, ArrowUpIcon, EqualsIcon, type Icon } from "@phosphor-icons/react";
import { Badge } from "@modelstill/ui/components/badge";
import type { TrainStatus } from "@/lib/api";
import type { CaseChange } from "@/lib/compare";
import { formatDateTime } from "@/lib/format";

export { ModeBadge } from "@modelstill/ui/blocks/mode-badge";
export { PassBadge, VerdictBadge } from "@modelstill/ui/blocks/verdict-badge";

type Variant = "success" | "warning" | "danger" | "info" | "secondary" | "outline";

const SEVERITY: Record<string, Variant> = { critical: "danger", error: "danger", warning: "warning", warn: "warning", info: "info" };

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge variant={SEVERITY[severity.toLowerCase()] ?? "outline"}>{severity}</Badge>;
}

const REVIEW: Record<string, Variant> = { accepted: "success", corrected: "info", pending: "warning", queued: "warning" };

export function ReviewStateBadge({ state }: { state: string }) {
  return (
    <Badge variant={REVIEW[state] ?? "outline"}>
      <span data-testid="review-state">{state}</span>
    </Badge>
  );
}

export function AlertStatusBadge({ ackedAt }: { ackedAt: string | null }) {
  if (ackedAt) return <Badge variant="secondary" title={formatDateTime(ackedAt)}>acked</Badge>;
  return <Badge variant="warning">open</Badge>;
}

const CHANGE: Record<CaseChange, Variant> = { same: "outline", fixed: "success", broken: "danger", changed: "warning" };

const CHANGE_ICON: Record<CaseChange, Icon> = { same: EqualsIcon, fixed: ArrowUpIcon, broken: ArrowDownIcon, changed: ArrowsLeftRightIcon };

export function ChangeBadge({ change }: { change: CaseChange }) {
  const ChangeIcon = CHANGE_ICON[change];
  return (
    <Badge variant={CHANGE[change]}>
      <ChangeIcon aria-hidden="true" weight="bold" />
      {change}
    </Badge>
  );
}

const TRAIN_STATUS: Record<TrainStatus, Variant> = { running: "info", succeeded: "success", failed: "danger" };

export function TrainStatusBadge({ status }: { status: TrainStatus }) {
  return <Badge variant={TRAIN_STATUS[status]}>{status}</Badge>;
}
