import { CheckCircleIcon, CircleDashedIcon, EqualsIcon, TrendDownIcon, TrendUpIcon, XCircleIcon, type Icon } from "@phosphor-icons/react";
import { Badge } from "@modelstill/ui/components/badge";

export type Verdict = "better" | "worse" | "no_detectable_difference";

const VERDICT_LABEL: Record<Verdict, string> = {
  better: "better",
  worse: "worse",
  no_detectable_difference: "no detectable difference",
};

const VERDICT_VARIANT: Record<Verdict, "success" | "danger" | "secondary"> = {
  better: "success",
  worse: "danger",
  no_detectable_difference: "secondary",
};

const VERDICT_ICON: Record<Verdict, Icon> = {
  better: TrendUpIcon,
  worse: TrendDownIcon,
  no_detectable_difference: EqualsIcon,
};

export function verdictLabel(verdict: Verdict): string {
  return VERDICT_LABEL[verdict];
}

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const VerdictIcon = VERDICT_ICON[verdict];
  return (
    <Badge variant={VERDICT_VARIANT[verdict]} className={className}>
      <VerdictIcon aria-hidden="true" weight="bold" />
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}

export function PassBadge({ passed, pendingLabel = "no gate yet" }: { passed: boolean | null; pendingLabel?: string }) {
  if (passed === null) {
    return (
      <Badge variant="outline">
        <CircleDashedIcon aria-hidden="true" />
        {pendingLabel}
      </Badge>
    );
  }
  const ResultIcon = passed ? CheckCircleIcon : XCircleIcon;
  return (
    <Badge variant={passed ? "success" : "danger"}>
      <ResultIcon aria-hidden="true" weight="fill" />
      {passed ? "pass" : "fail"}
    </Badge>
  );
}
