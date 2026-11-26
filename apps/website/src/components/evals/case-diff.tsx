"use client";

import { useEffect, useRef, useState } from "react";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { JsonView } from "@modelstill/ui/blocks/json-view";
import { TeacherDiff } from "@modelstill/ui/blocks/teacher-diff";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@modelstill/ui/components/toggle-group";
import { cn } from "@modelstill/ui/lib/utils";
import { ChangeBadge } from "@/components/badges";
import { LineDiff } from "@/components/evals/line-diff";
import { ErrorState, LoadingState } from "@/components/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import type { ComparedCase } from "@/lib/api";
import { caseChange } from "@/lib/compare";
import { metricLabel } from "@/lib/format";

type Loaded = { status: "loading" } | { status: "error"; error: Error } | { status: "ready"; data: ComparedCase };

function useCase(inputHash: string, load: (inputHash: string) => Promise<ComparedCase>) {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    latest.current(inputHash).then(
      (data) => live && setState({ status: "ready", data }),
      (error: unknown) => live && setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      live = false;
    };
  }, [inputHash, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

function showNumber(value: number | undefined): string {
  if (value === undefined) return "missing";
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function showDelta(before: number | undefined, after: number | undefined): string {
  if (before === undefined || after === undefined) return "n/a";
  const delta = after - before;
  if (delta === 0) return "0";
  const text = Number.isInteger(delta) ? String(Math.abs(delta)) : Math.abs(delta).toFixed(3);
  return `${delta > 0 ? "+" : "-"}${text}`;
}

function scoreRows(detail: ComparedCase): { name: string; before?: number; after?: number }[] {
  const names = [...new Set([...Object.keys(detail.before.metrics), ...Object.keys(detail.after.metrics)])].sort();
  return [
    { name: "score", before: detail.before.score, after: detail.after.score },
    ...names.map((name) => ({ name, before: detail.before.metrics[name], after: detail.after.metrics[name] })),
  ];
}

function CaseScores({ detail }: { detail: ComparedCase }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-muted-foreground">Per-case score</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">Before</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">After</TableHead>
            <TableHead className="px-3 text-right text-muted-foreground">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {scoreRows(detail).map((row) => {
            const delta = row.before === undefined || row.after === undefined ? 0 : row.after - row.before;
            return (
              <TableRow key={row.name} data-testid="case-score-row" data-metric={row.name}>
                <TableCell className="px-3 py-1">{row.name === "score" ? "case score" : metricLabel(row.name)}</TableCell>
                <TableCell className="px-3 py-1 text-right tabular-nums">{showNumber(row.before)}</TableCell>
                <TableCell className="px-3 py-1 text-right tabular-nums">{showNumber(row.after)}</TableCell>
                <TableCell
                  className={cn(
                    "h-8 px-3 py-1 text-right font-medium tabular-nums",
                    delta > 0 && "text-status-ok",
                    delta < 0 && "text-status-fail",
                  )}
                >
                  {showDelta(row.before, row.after)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function outputsOf(detail: ComparedCase) {
  const sides = [
    { teacher: "before", output: detail.before.output },
    { teacher: "after", output: detail.after.output },
  ];
  return detail.expected === null || detail.expected === undefined ? sides : [{ teacher: "expected", output: detail.expected }, ...sides];
}

type Side = "before" | "after";

function ExpectedAgainstOutput({ detail }: { detail: ComparedCase }) {
  const [side, setSide] = useState<Side>("after");
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={side}
        onValueChange={(value: string) => value && setSide(value as Side)}
        aria-label="Output to diff"
        data-testid="line-diff-side"
      >
        <ToggleGroupItem value="before" aria-label="Before" className="px-2.5">
          Before
        </ToggleGroupItem>
        <ToggleGroupItem value="after" aria-label="After" className="px-2.5">
          After
        </ToggleGroupItem>
      </ToggleGroup>
      <LineDiff expected={detail.expected} output={detail[side].output} />
    </div>
  );
}

function CaseBody({ detail }: { detail: ComparedCase }) {
  return (
    <div data-testid="case-diff" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="type-label text-muted-foreground">Input</h3>
        <div data-testid="case-input">
          {detail.input === null || detail.input === undefined ? (
            <p className="text-muted-foreground">The run was pushed without inputs; push cases with an input to see it here.</p>
          ) : (
            <JsonView value={detail.input} maxHeight={220} />
          )}
        </div>
      </div>
      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields" className="text-[13px]">
            Fields
          </TabsTrigger>
          <TabsTrigger value="lines" className="text-[13px]">
            Expected vs output
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fields">
          <TeacherDiff outputs={outputsOf(detail)} />
        </TabsContent>
        <TabsContent value="lines">
          <ExpectedAgainstOutput detail={detail} />
        </TabsContent>
      </Tabs>
      <CaseScores detail={detail} />
    </div>
  );
}

export function CaseDiff({
  inputHash,
  before,
  after,
  load,
}: {
  inputHash: string;
  before: ComparedCase["before"]["score"] | boolean | string | null;
  after: ComparedCase["after"]["score"] | boolean | string | null;
  load: (inputHash: string) => Promise<ComparedCase>;
}) {
  const { state, retry } = useCase(inputHash, load);
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Case <CodeId value={inputHash} length={16} />
          <ChangeBadge change={caseChange({ before, after })} />
        </CardTitle>
        <CardDescription>Input, expected answer and both outputs side by side, with every per-case score.</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {state.status === "loading" && <LoadingState rows={3} />}
        {state.status === "error" && <ErrorState error={state.error} onRetry={retry} />}
        {state.status === "ready" && <CaseBody detail={state.data} />}
      </CardContent>
    </Card>
  );
}
