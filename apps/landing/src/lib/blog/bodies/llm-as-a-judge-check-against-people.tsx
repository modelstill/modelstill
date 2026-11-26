import { Code, CodeBlock, Docs, DocsCard, Note, Post } from "@/components/blog/body-kit";

const AGREEMENT = `
from modelstill.evals import judge_agreement

agreement = judge_agreement(judge_verdicts, human_labels)
print(agreement.accuracy, agreement.low, agreement.high, agreement.kappa)
print(agreement.false_pass, agreement.false_fail)
`;

const STABILITY = `
from modelstill.judges import stability

found = stability(judge, items, repeats=3)
print(found.flip_rate, found.unstable, found.items)
`;

const CORRECTED = `
from modelstill.judges import corrected_score

estimate = corrected_score(judge_scores, human_labels)
print(estimate.value, estimate.low, estimate.high)
`;

const PAIRWISE = `
modelstill eval pairwise runs.jsonl <before> <after> --spec tasks/<task>/spec.yaml \\
  --base-url http://localhost:4000 --api-key-env LITELLM_API_KEY
`;

const PANEL = `
from modelstill.evals import run
from modelstill.judges import JudgePanel, LLMJudge, as_metric

judge = LLMJudge(model, family, instructions, complete)
panel = JudgePanel([judge], teacher_families={"qwen", "openai"})
result = run(cases, student, as_metric(panel))
`;

export const body = (
  <>
    <p>
      Exact match works when there is one right answer. For a summary, a reply or an explanation there is not, so teams ask another model to grade the output. That is LLM-as-a-judge, and it is often the only practical way to score open-ended answers.
    </p>
    <p>
      But a judge is a model too. It can be lenient, harsh, inconsistent or biased towards its own family. Before its verdict decides a release, you need to know how often it agrees with people. This post shows the checks ModelStill gives you, following the <Docs doc="/guides/llm-as-a-judge">LLM-as-a-judge guide</Docs>.
    </p>

    <h2>The judge is a rubric and a verdict</h2>
    <p>
      An <Code>LLMJudge</Code> gets your instructions as the system message, with &quot;End your reply with PASS or FAIL.&quot; added. The user message holds the reference answer and the output. The last PASS or FAIL in the reply is the verdict. A reply with neither raises an error, and the run stops instead of guessing.
    </p>
    <CodeBlock title="judge.py">{PANEL}</CodeBlock>
    <p>
      <Code>complete</Code> is your function that calls the judge model, so you choose the provider and the temperature. <Code>as_metric</Code> turns the judge into a scorer that gives 1 for PASS and 0 for FAIL, and pass/fail scores get an exact Clopper-Pearson interval.
    </p>

    <h2>Check it against people</h2>
    <p>
      Have people label a sample of the same outputs as pass or fail. The <Post slug="golden-dataset-from-production-traces">golden dataset</Post> you already review is a good source. Then compare the two lists, item by item:
    </p>
    <CodeBlock title="agreement.py">{AGREEMENT}</CodeBlock>
    <ul>
      <li>
        <Code>accuracy</Code> is the share of items where judge and person agree, with an exact Clopper-Pearson interval (<Code>low</Code>, <Code>high</Code>).
      </li>
      <li>
        <Code>kappa</Code> is Cohen&apos;s kappa: agreement beyond what the two pass rates would give by chance.
      </li>
      <li>
        <Code>false_pass</Code> counts items the judge passed and the person failed. <Code>false_fail</Code> is the reverse.
      </li>
    </ul>
    <p>
      Read kappa before accuracy. When most outputs pass, a judge that passes everything has high accuracy and a kappa near 0. It has learnt nothing about your task.
    </p>
    <p>
      For a release gate, false passes matter most. Each one is a bad answer the judge let through. A judge with few false fails and many false passes will wave regressions into production.
    </p>
    <Note>
      The spec&apos;s gate has no kappa field. You can add your own <Code>judge_human_kappa</Code> check, with a floor you choose, next to the gate&apos;s checks. The guide shows how, and notes that <Code>modelstill report gate</Code> does not add it for you.
    </Note>

    <h2>Check that it is stable</h2>
    <p>A judge that changes its mind on the same input adds noise to every score it gives.</p>
    <CodeBlock title="stability.py">{STABILITY}</CodeBlock>
    <p>
      Each item is judged <Code>repeats</Code> times, at least twice. An item is unstable when its verdicts differ, and <Code>flip_rate</Code> is the share of unstable items. Measure it at the temperature you will actually use.
    </p>

    <h2>Correct the score with a few human labels</h2>
    <p>
      A judge can be biased in one direction, for example passing slightly too much. <Code>corrected_score</Code> uses a small set of human labels to remove that bias from the judge&apos;s score over a much larger set of items. The method is prediction-powered inference.
    </p>
    <CodeBlock title="corrected.py">{CORRECTED}</CodeBlock>
    <p>
      It needs at least two labelled and two unlabelled items, and every labelled item must also be judged. The result carries a 95% interval.
    </p>
    <p>
      One caveat. That interval comes from a normal approximation, unlike the exact and bootstrap intervals elsewhere in ModelStill. With very few labels it can be too narrow, so label more items than the minimum before you lean on it.
    </p>

    <h2>Compare two runs with a pairwise judge</h2>
    <p>
      Sometimes the question is not &quot;is this answer right?&quot; but &quot;is the new answer better than the old one?&quot;. A <Code>PairwiseJudge</Code> picks A, B or a tie for two answers to the same input.
    </p>
    <p>
      Judges tend to prefer whichever answer they see first or second. So ModelStill asks twice, once in each order, and keeps a verdict only when both orders agree. A verdict that follows the position becomes an inconsistent tie, so position bias cannot create wins.
    </p>
    <CodeBlock title="Terminal">{PAIRWISE}</CodeBlock>
    <p>
      It prints wins for each run, ties, the later run&apos;s win rate over decisive cases with an exact interval, a sign test, and the inconsistency rate with its own exact interval. A high inconsistency rate means the judge cannot tell the answers apart, so trust the win rate less.
    </p>

    <h2>Keep the judge out of the teacher&apos;s family</h2>
    <p>
      A judge tends to prefer answers in the style of its own model family. If it shares a family with the teacher that labelled the training data, the student is graded by its teacher&apos;s taste. ModelStill refuses that in three places:
    </p>
    <ul>
      <li>
        <Code>modelstill spec validate</Code> refuses a spec whose <Code>eval.judge</Code> family is a teacher family.
      </li>
      <li>
        <Code>JudgePanel</Code> refuses a judge from a teacher family, and holds at most one judge per family.
      </li>
      <li>
        Pairwise comparisons and <Code>parity_metric</Code> take the teacher families and refuse an overlap.
      </li>
    </ul>
    <p>
      An <Code>LLMJudge</Code> on its own does not check. Call <Code>check_independent</Code> before you use a single judge, or put it in a one-judge panel as in the example above.
    </p>

    <h2>Then</h2>
    <p>
      Once the judge agrees with people, its scores can feed the same paired comparison and gate as any other metric. See <Post slug="llm-eval-framework-release-decision">what an LLM eval framework should decide</Post>.
    </p>
    <div className="docs-cards">
      <DocsCard doc="/guides/llm-as-a-judge" title="LLM-as-a-judge guide">
        Agreement, kappa, stability, corrected scores and pairwise judging.
      </DocsCard>
      <DocsCard doc="/reference/statistics" title="Statistics">
        How each interval and test is computed.
      </DocsCard>
    </div>
  </>
);
