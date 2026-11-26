import { Code, CodeBlock, Docs, DocsCard, Note, Post } from "@/components/blog/body-kit";

const INSTALL = `
uv tool install "git+https://github.com/modelstill/modelstill#subdirectory=python/modelstill"
modelstill quickstart demo
modelstill report gate demo/history.jsonl 2d1857f9 \\
    --spec demo/tasks/ticket-priority-example/spec.yaml \\
    --previous 248036ea \\
    --flip-rate 0.004 --cost-ratio 0.82 --p95-latency-ms 640
`;

const DEMO_OUTPUT = `
Wrote an example project to demo (example data: generated tickets and recorded
model answers, no API key or network needed).

  demo/tasks/ticket-priority-example/  task spec, prompt and 240 example tickets
  demo/history.jsonl                   three recorded runs, baseline accepted

  248036ea  prompt-v1  accuracy 0.933 [0.894, 0.961]  the accepted baseline
  2d1857f9  prompt-v2  accuracy 0.958 [0.925, 0.980]  clearer billing rules and a shorter prompt
  48c5a1b6  prompt-v3  accuracy 0.883 [0.836, 0.921]  a cheaper prompt that dropped the data-at-risk rule
`;

const PASS_OUTPUT = `
<!-- modelstill-gate -->
### ModelStill gate: passed

Run \`2d1857f9\` (prompt-v2) on \`golden@493c3e2b\`, compared with \`248036ea\` (prompt-v1).
per-case mean 0.958 [0.925, 0.980], 240 cases.

| Check | Threshold | Measured | Interval | Result |
|---|---|---|---|---|
| regression_vs_baseline | >= -0.020 | 0.000 | [+0.000, +0.050] | pass |
| flip_rate | <= 0.010 | 0.004 | not sampled | pass |
| cost_ratio | <= 1.000 | 0.820 | not sampled | pass |
| p95_latency_ms | <= 2000 | 640 | not sampled | pass |

#### Paired comparison

Difference +0.025 [+0.000, +0.050] (no detectable difference) over 240 cases: 8 fixed, 2 broken.
`;

const FAIL_COMMAND = `
modelstill report gate demo/history.jsonl 48c5a1b6 \\
    --spec demo/tasks/ticket-priority-example/spec.yaml \\
    --previous 248036ea \\
    --flip-rate 0.004 --cost-ratio 0.55 --p95-latency-ms 590
`;

const FAIL_OUTPUT = `
<!-- modelstill-gate -->
### ModelStill gate: failed

Run \`48c5a1b6\` (prompt-v3) on \`golden@493c3e2b\`, compared with \`248036ea\` (prompt-v1).
per-case mean 0.883 [0.836, 0.921], 240 cases.

| Check | Threshold | Measured | Interval | Result |
|---|---|---|---|---|
| regression_vs_baseline | >= -0.020 | -0.092 | [-0.092, -0.008] | **fail** |
| flip_rate | <= 0.010 | 0.004 | not sampled | pass |
| cost_ratio | <= 1.000 | 0.550 | not sampled | pass |
| p95_latency_ms | <= 2000 | 590 | not sampled | pass |

#### Paired comparison

Difference -0.050 [-0.092, -0.008] (worse) over 240 cases: 8 fixed, 20 broken.
`;

export const body = (
  <>
    <p>
      Most eval tools end with a number. You change a prompt, run the suite, and get 0.958 where you had 0.933. The number went up. Do you ship?
    </p>
    <p>
      A number cannot answer that. A release is a yes or a no, and an LLM eval framework is only useful if it gives you one, with the reasons written down. This post covers what that decision needs and how ModelStill makes it.
    </p>

    <h2>A score is a measurement, not a decision</h2>
    <p>Three things hide behind a single score.</p>
    <ul>
      <li>
        <strong>Noise.</strong> On 240 cases, a few answers flipping either way moves the mean by a point or two. A rise of 0.025 can be luck.
      </li>
      <li>
        <strong>Swaps.</strong> A new prompt can fix eight cases and break two. The mean shows a gain of six. It does not show the two customers who now get a wrong answer.
      </li>
      <li>
        <strong>Everything else.</strong> A prompt that scores the same but costs twice as much, or answers twice as slowly, is not the same release.
      </li>
    </ul>
    <p>A framework that decides has to deal with all three.</p>

    <h2>Compare with the baseline, case by case</h2>
    <p>
      The question is not &quot;is the new score high?&quot; but &quot;is the new run worse than the one we already trust?&quot;. So the candidate is compared with an accepted baseline, on the same cases, in the same order.
    </p>
    <p>
      For each case ModelStill takes the candidate&apos;s score minus the baseline&apos;s. The mean of those differences is the paired difference. A seeded bootstrap of the per-case differences gives its interval. The verdict reads the interval, not the mean:
    </p>
    <ul>
      <li>
        <Code>better</Code> when the whole interval is above 0,
      </li>
      <li>
        <Code>worse</Code> when the whole interval is below 0,
      </li>
      <li>
        <Code>no_detectable_difference</Code> otherwise.
      </li>
    </ul>
    <p>
      Next to it you get the <strong>fixed</strong> and <strong>broken</strong> counts: cases that scored higher after the change, and cases that scored lower. Pairing matters because cases differ in difficulty far more than one prompt differs from the next. Comparing each case with itself removes that spread. The <Docs doc="/reference/statistics">statistics reference</Docs> has the details.
    </p>
    <p>
      Runs are only compared when they ran on the same version of the set. A baseline recorded on an older set is not silently mixed with a new one.
    </p>

    <h2>Every number carries an interval</h2>
    <p>
      Every score ModelStill reports carries a 95% interval. Pass/fail scores get an exact Clopper-Pearson interval. Other scores, such as set F1 or judge scores, get a seeded percentile bootstrap, so the same scores always give the same interval.
    </p>
    <p>
      The gate reads lower bounds. The regression check passes only when the lower bound of the paired difference is above the regression you allow. A small set cannot pass on a lucky mean, and a wide interval is an honest message: this set is too small to prove much.
    </p>

    <h2>Quality is not the only check</h2>
    <p>The gate in a task spec holds four checks:</p>
    <ul>
      <li>
        <Code>regression_vs_baseline</Code>: the paired lower bound against the accepted baseline, as above. A spec can also set an absolute floor on the run&apos;s own lower bound.
      </li>
      <li>
        <Code>flip_rate</Code>, capped by the spec&apos;s <Code>max_flip_rate</Code>.
      </li>
      <li>
        <Code>cost_ratio</Code>, the candidate&apos;s cost as a share of the baseline&apos;s, capped by <Code>max_cost_ratio</Code>.
      </li>
      <li>
        <Code>p95_latency_ms</Code>, the slow end of response times, capped by <Code>max_p95_latency_ms</Code>.
      </li>
    </ul>
    <p>
      Flip rate, cost ratio and latency are measured outside ModelStill and passed in, so the report marks them &quot;not sampled&quot;. A value nobody measured should be passed at a failing worst case, such as <Code>--flip-rate 1</Code>. Then the gate fails honestly instead of passing on a number nobody checked.
    </p>

    <h2>The decision is stored and has an exit code</h2>
    <p>
      A gate decision lists every check with its threshold, measured value and result. <Code>modelstill report gate</Code> prints it as Markdown for a pull request comment or as JSON to keep next to the run, so the decision can be re-read later.
    </p>
    <p>
      It exits 0 on a pass, 2 on a fail and 1 on an error, such as an unknown run or a regression gate without a baseline. That is all a CI job needs. The <Docs doc="/guides/ci-gate">CI guide</Docs> wires it into GitHub Actions with one sticky comment per pull request.
    </p>

    <h2>See it pass and fail in three commands</h2>
    <p>
      No API key and no network after the install. You need <a href="https://docs.astral.sh/uv/">uv</a>, which fetches Python 3.12 if you do not have it. These are the commands from the <Docs doc="/quickstart">quickstart</Docs>:
    </p>
    <CodeBlock title="Terminal">{INSTALL}</CodeBlock>
    <p>
      <Code>modelstill quickstart demo</Code> writes a ticket-triage task with 240 generated example tickets and three recorded runs. It is example data, not real tickets or real model answers:
    </p>
    <CodeBlock title="Output">{DEMO_OUTPUT}</CodeBlock>
    <p>
      The gate for <Code>prompt-v2</Code> passes and exits 0. Its mean rose by 0.025, but the paired interval starts at 0.000, so the verdict is &quot;no detectable difference&quot;. It passes because the lower bound is above the allowed regression of -0.020, not because it proved an improvement:
    </p>
    <CodeBlock title="Output">{PASS_OUTPUT}</CodeBlock>
    <p>Now the cheaper prompt:</p>
    <CodeBlock title="Terminal">{FAIL_COMMAND}</CodeBlock>
    <p>
      <Code>prompt-v3</Code> costs less and scores 0.883 against the baseline&apos;s 0.933. It fixed 8 tickets and broke 20. The lower bound of the paired difference, -0.092, is below -0.020, so the gate fails and exits 2:
    </p>
    <CodeBlock title="Output">{FAIL_OUTPUT}</CodeBlock>
    <Note>
      The cost and latency checks pass for <Code>prompt-v3</Code>. Only the case-by-case comparison stops it. An average-only dashboard would show a cheaper prompt that lost five points, and someone would have to decide whether five points is noise.
    </Note>

    <h2>Then</h2>
    <p>
      The demo uses a ready-made set. For your own task you need cases people have checked: see <Post slug="golden-dataset-from-production-traces">how to build a golden dataset from production traces</Post>. If your answers are open-ended, you will need a judge, and <Post slug="llm-as-a-judge-check-against-people">the judge needs checking too</Post>.
    </p>
    <div className="docs-cards">
      <DocsCard doc="/quickstart" title="Quickstart">
        Define your own task, record runs and push them to the dashboard.
      </DocsCard>
      <DocsCard doc="/guides/ci-gate" title="Gate in CI">
        Run the same gate on every pull request.
      </DocsCard>
    </div>
  </>
);
