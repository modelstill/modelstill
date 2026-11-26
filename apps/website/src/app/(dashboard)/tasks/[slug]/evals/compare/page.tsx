"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { ArrowLeftIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { CodeId } from "@modelstill/ui/blocks/code-id";
import { PageHeader } from "@modelstill/ui/blocks/page-header";
import { Section } from "@modelstill/ui/blocks/section";
import { HeaderLink } from "@/components/dashboard/header-link";
import { PageActions } from "@/components/dashboard/page-actions";
import { PageBody } from "@/components/dashboard/shell";
import { SendToReviewButton, useSendToReview } from "@/components/evals/send-to-review";
import type { Comparison, ComparedCase } from "@/lib/api";
import { casesIn, metricFilterFrom, type MetricFilter } from "@/lib/compare";
import { CompareCasesTable } from "@/components/evals/compare-cases-table";
import { ComparisonHeadline } from "@/components/evals/comparison-headline";
import { MetricComparisonTable } from "@/components/evals/metric-comparison-table";
import { LoadingState, ResourceView } from "@/components/states";
import { TaskEmptyState } from "@/components/task-empty";
import { evalRunHref, taskHref, taskSectionHref } from "@/lib/nav";
import { useApiClient, useResource } from "@/lib/use-api";
import { useSlug } from "@/lib/use-slug";

function ComparisonBody({
  slug,
  data,
  loadCase,
  initialFilter,
}: {
  slug: string;
  data: Comparison;
  loadCase: (inputHash: string) => Promise<ComparedCase>;
  initialFilter: MetricFilter | null;
}) {
  const review = useSendToReview({ slug, beforeRun: data.before, afterRun: data.after, loadCase });
  const [metricFilter, setMetricFilter] = useState<MetricFilter | null>(initialFilter);
  const pickFilter = (filter: MetricFilter) => {
    setMetricFilter(filter);
    document.getElementById("compare-cases")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const broken = casesIn(data.cases, "broken").map((entry) => entry.inputHash);
  return (
    <>
      <PageActions>
        <HeaderLink href={taskSectionHref(slug, "gates")} icon={ShieldCheckIcon}>
          Gates
        </HeaderLink>
        <SendToReviewButton
          primary
          count={broken.length}
          sending={review.sending}
          onClick={() => void review.send(broken)}
          label={broken.length === 0 ? "No broken cases" : `Send ${broken.length} broken to review`}
        />
      </PageActions>
      <ComparisonHeadline comparison={data} />
      <Section title="Metrics" description="each run with its interval, and the paired difference when both logged per-case scores">
        <MetricComparisonTable metrics={data.metrics} onFilter={pickFilter} />
      </Section>
      <div id="compare-cases" className="scroll-mt-4">
        <Section title="Cases" description="worst regressions first; pick a case to see both outputs">
          <CompareCasesTable
            cases={data.cases}
            loadCase={loadCase}
            onSend={(hashes) => void review.send(hashes)}
            sending={review.sending}
            metricFilter={metricFilter}
            onClearMetricFilter={() => setMetricFilter(null)}
          />
        </Section>
      </div>
    </>
  );
}

function ComparisonView({ slug, before, after, initialFilter }: { slug: string; before: string; after: string; initialFilter: MetricFilter | null }) {
  const api = useApiClient();
  const comparison = useResource((client) => client.compareEvalRuns(before, after), [before, after]);
  const loadCase = useCallback((inputHash: string) => api.getComparedCase(before, after, inputHash), [api, before, after]);
  return (
    <ResourceView resource={comparison} loading="cards" empty="The API returned no comparison.">
      {(data) => <ComparisonBody slug={slug} data={data} loadCase={loadCase} initialFilter={initialFilter} />}
    </ResourceView>
  );
}

function ComparePageContent() {
  const slug = useSlug();
  const params = useSearchParams();
  const before = params.get("before");
  const after = params.get("after");
  return (
    <PageBody className="max-w-none gap-5 py-5 sm:px-5 sm:py-5">
      <PageActions>
        <HeaderLink href={`${taskHref(slug)}/evals`} icon={ArrowLeftIcon}>
          Eval runs
        </HeaderLink>
      </PageActions>
      <PageHeader
        title="Compare eval runs"
        description="The paired difference with its interval decides the verdict."
        meta={
          before && after ? (
            <>
              <Link href={evalRunHref(slug, before)} className="inline-flex items-center gap-1 hover:text-foreground">
                before <CodeId value={before} copy={false} />
              </Link>
              <Link href={evalRunHref(slug, after)} className="inline-flex items-center gap-1 hover:text-foreground">
                after <CodeId value={after} copy={false} />
              </Link>
            </>
          ) : undefined
        }
      />
      {before && after ? (
        <ComparisonView slug={slug} before={before} after={after} initialFilter={metricFilterFrom(params)} />
      ) : (
        <TaskEmptyState
          page={{
            key: "evals",
            title: "No runs picked",
            command: "modelstill eval compare history.jsonl <before> <after>",
            shows: "Pick two runs on the eval runs page: the paired difference with its interval, every metric, and each fixed or broken case side by side.",
          }}
        />
      )}
    </PageBody>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ComparePageContent />
    </Suspense>
  );
}
