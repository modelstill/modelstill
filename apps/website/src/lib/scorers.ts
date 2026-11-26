export type ScorerStatus = "built_in" | "planned";

export type ScorerTemplate = {
  key: string;
  name: string;
  status: ScorerStatus;
  summary: string;
  proof: string;
  code: string | null;
  runbook: string;
};

export const SCORER_TEMPLATES: ScorerTemplate[] = [
  {
    key: "exact_match",
    name: "Exact match",
    status: "built_in",
    summary: "1 when the output equals the expected answer, else 0.",
    proof: "Binary scores get an exact Clopper-Pearson interval.",
    code: "from modelstill.evals import exact_match, run\nresult = run(cases, model, exact_match)",
    runbook: "scorers.md#exact-match",
  },
  {
    key: "set_f1",
    name: "Set F1",
    status: "built_in",
    summary: "F1 between the predicted and expected sets, for tags and extracted names.",
    proof: "Per-case F1 gets a seeded bootstrap interval; pooled F1 is reported beside it.",
    code: "from modelstill.evals import run, set_f1\nresult = run(cases, model, set_f1)",
    runbook: "scorers.md#set-f1",
  },
  {
    key: "json_equal",
    name: "JSON equal",
    status: "built_in",
    summary: "1 when the output parses as JSON and equals the expected object, key order ignored.",
    proof: "Unparseable answers score 0, so broken JSON can never raise the score.",
    code: "canary:\n  metric: {ref: json_equal}",
    runbook: "scorers.md#json-equal",
  },
  {
    key: "llm_judge",
    name: "LLM judge, checked against people",
    status: "built_in",
    summary: "A rubric judge from a different model family than the teacher, held to human labels.",
    proof: "judge_agreement gives accuracy with an exact interval and kappa; corrected_score fixes the judge's bias with the human labels.",
    code: "judge = LLMJudge(model, family, instructions, complete)\nagreement = judge_agreement(judge_verdicts, human_labels)",
    runbook: "scorers.md#llm-judge-checked-against-people",
  },
  {
    key: "pairwise",
    name: "Pairwise preference",
    status: "planned",
    summary: "A judge picks the better of two answers to the same input, in both orders.",
    proof: "Wins against losses will get an exact sign test; ties and order flips are counted, not hidden.",
    code: null,
    runbook: "scorers.md#pairwise-preference",
  },
];

export function runbookHref(path: string, repoUrl: string | undefined): string | null {
  if (!repoUrl) return null;
  return `${repoUrl.replace(/\/+$/, "")}/blob/main/docs/runbooks/${path}`;
}

export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL;
