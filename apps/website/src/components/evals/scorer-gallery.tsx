import { ArrowSquareOutIcon, CheckCircleIcon, HourglassMediumIcon } from "@phosphor-icons/react";
import { Badge } from "@modelstill/ui/components/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@modelstill/ui/components/card";
import { REPO_URL, runbookHref, SCORER_TEMPLATES, type ScorerStatus, type ScorerTemplate } from "@/lib/scorers";

function StatusBadge({ status }: { status: ScorerStatus }) {
  if (status === "planned") {
    return (
      <Badge variant="outline">
        <HourglassMediumIcon aria-hidden="true" />
        planned
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      <CheckCircleIcon aria-hidden="true" weight="fill" />
      built in
    </Badge>
  );
}

function RunbookLink({ template, repoUrl }: { template: ScorerTemplate; repoUrl: string | undefined }) {
  const path = `docs/runbooks/${template.runbook}`;
  const href = runbookHref(template.runbook, repoUrl);
  if (!href) return <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-primary hover:underline">
      <span className="truncate">{path}</span>
      <ArrowSquareOutIcon aria-hidden="true" className="size-3 shrink-0" />
    </a>
  );
}

export function ScorerGallery({ repoUrl = REPO_URL }: { repoUrl?: string | undefined }) {
  return (
    <section aria-label="Scorer templates" className="flex w-full flex-col gap-3 text-left">
      <div className="flex flex-col gap-0.5">
        <h2 className="type-title">Start from a scorer</h2>
        <p className="text-xs text-muted-foreground">Every score is pushed with its interval; pick the scorer that fits the task.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SCORER_TEMPLATES.map((template) => (
          <Card key={template.key} data-testid="scorer-template" data-template={template.key} className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{template.name}</CardTitle>
              <CardAction>
                <StatusBadge status={template.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
              <CardDescription className="text-xs">{template.summary}</CardDescription>
              {template.code && (
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-4">
                  <code>{template.code}</code>
                </pre>
              )}
              <p className="text-xs text-muted-foreground">{template.proof}</p>
            </CardContent>
            <CardFooter className="mt-auto px-4">
              <RunbookLink template={template} repoUrl={repoUrl} />
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
