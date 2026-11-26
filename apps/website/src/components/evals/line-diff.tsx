import { cn } from "@modelstill/ui/lib/utils";
import { lineDiff, textLines, type DiffLine } from "@/lib/compare";

const MARK: Record<DiffLine["kind"], string> = { same: " ", removed: "-", added: "+" };

export function LineDiff({ expected, output }: { expected: unknown; output: unknown }) {
  if (expected === null || expected === undefined) {
    return <p className="text-muted-foreground">This case has no expected answer to diff against.</p>;
  }
  const lines = lineDiff(textLines(expected), textLines(output));
  const changed = lines.filter((line) => line.kind !== "same").length;
  return (
    <div data-testid="line-diff" className="flex flex-col overflow-hidden rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span>- expected · + output</span>
        <span>{changed === 0 ? "identical" : `${changed} lines differ`}</span>
      </div>
      <pre className="max-h-80 overflow-auto py-1 font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div
            key={index}
            data-testid={`line-${line.kind}`}
            className={cn(
              "flex gap-2 px-3",
              line.kind === "removed" && "bg-status-fail-bg text-status-fail",
              line.kind === "added" && "bg-status-ok-bg text-status-ok",
            )}
          >
            <span aria-hidden="true" className="w-2 shrink-0 select-none">
              {MARK[line.kind]}
            </span>
            <span className="whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
