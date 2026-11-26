import { Badge } from "@modelstill/ui/components/badge";

export type Mode = "off" | "shadow" | "serve";

type BadgeVariant = "outline" | "info" | "success";

const MODE_VARIANT: Record<Mode, BadgeVariant> = { off: "outline", shadow: "info", serve: "success" };

const MODE_HINT: Record<Mode, string> = {
  off: "Every call goes to the cloud model",
  shadow: "The student answers in the background; the cloud answer is served",
  serve: "The student answers; low-confidence calls defer to the cloud",
};

export function ModeBadge({ mode, className }: { mode: Mode; className?: string }) {
  return (
    <Badge variant={MODE_VARIANT[mode]} title={MODE_HINT[mode]} className={className}>
      {mode}
    </Badge>
  );
}
