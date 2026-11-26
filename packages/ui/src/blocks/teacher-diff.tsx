import { Badge } from "@modelstill/ui/components/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@modelstill/ui/components/table";
import { cn } from "@modelstill/ui/lib/utils";

export type TeacherOutputEntry = { teacher: string; output: unknown };

export type TeacherDiffRow = { path: string; values: unknown[]; differs: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flatten(value: unknown, prefix: string, into: Map<string, unknown>) {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, into);
    return;
  }
  into.set(prefix || "value", value);
}

export function diffTeacherOutputs(outputs: readonly TeacherOutputEntry[]): TeacherDiffRow[] {
  const flattened = outputs.map((entry) => {
    const map = new Map<string, unknown>();
    flatten(entry.output, "", map);
    return map;
  });
  const paths = [...new Set(flattened.flatMap((map) => [...map.keys()]))].sort();
  return paths.map((path) => {
    const values = flattened.map((map) => map.get(path));
    const first = JSON.stringify(values[0]);
    return { path, values, differs: values.some((value) => JSON.stringify(value) !== first) };
  });
}

function show(value: unknown): string {
  if (value === undefined) return "missing";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(", ")}]`;
  return JSON.stringify(value);
}

export function TeacherDiff({ outputs, className }: { outputs: TeacherOutputEntry[]; className?: string }) {
  if (outputs.length === 0) return <p className="text-muted-foreground">No teacher outputs were logged for this item.</p>;
  const rows = diffTeacherOutputs(outputs);
  const differing = rows.filter((row) => row.differs).length;
  return (
    <div data-slot="teacher-diff" className={cn("flex flex-col overflow-hidden rounded-md border", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {differing} of {rows.length} fields differ
        </span>
        {differing > 0 && <Badge variant="warning">disagreement</Badge>}
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-40 px-3 text-muted-foreground">Field</TableHead>
            {outputs.map((entry) => (
              <TableHead key={entry.teacher} className="px-3 font-mono text-muted-foreground">
                {entry.teacher}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.path} data-testid="teacher-diff-row" data-path={row.path} data-differs={row.differs} className="align-top">
              <TableCell className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{row.path}</TableCell>
              {row.values.map((value, index) => (
                <TableCell
                  key={outputs[index]!.teacher}
                  className={cn(
                    "px-3 py-1.5 font-mono text-xs break-words whitespace-pre-wrap",
                    row.differs && "bg-warning/10 text-foreground",
                    value === undefined && "text-muted-foreground italic",
                  )}
                >
                  {show(value)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
