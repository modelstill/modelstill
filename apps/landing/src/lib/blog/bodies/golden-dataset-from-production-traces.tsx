import { Code, CodeBlock, Docs, DocsCard, Note, Post } from "@/components/blog/body-kit";

const INGEST = `
modelstill ingest langfuse --from 2026-11-01T00:00:00Z --name <observation-name> --out data/records.jsonl
`;

const LABEL = `
from pathlib import Path

from modelstill.data import DatasetStore, label

store = DatasetStore(Path("data/records.jsonl"))
report = label(store.load(), {"teacher-a": ask_a, "teacher-b": ask_b}, same_answer)
store.save(report.items)
print(report.agreed, report.disagreed, report.failed)
`;

const REVIEW = `
modelstill push review data/records.jsonl --task <task>
`;

const SPLIT = `
from modelstill.data import split

parts = split(store.load(), {"train": 0.9, "val": 0.1}, seed="v1", exclude=golden_ids)
`;

const ACCEPT = `
modelstill eval runs history.jsonl
modelstill eval accept history.jsonl <run>
`;

export const body = (
  <>
    <p>
      A golden dataset is a set of cases whose answers people have checked. Every prompt and model change is scored on it. If the set is wrong, every decision made on it is wrong too.
    </p>
    <p>
      The best source of cases is the traffic you already serve. Hand-written examples test what you imagined users would send. Production traces test what they actually send. This post walks from logged calls to a versioned set that a release gate can use, following the <Docs doc="/guides/golden-dataset">golden dataset guide</Docs>.
    </p>

    <h2>Start from the calls you already log</h2>
    <p>Read logged calls into a dataset file. With Langfuse:</p>
    <CodeBlock title="Terminal">{INGEST}</CodeBlock>
    <p>
      The same works for Braintrust, OpenTelemetry GenAI spans, LiteLLM spend logs and any JSONL. Rows with the same input are merged, and each row keeps its source ids, so you can always find the original trace. See <Docs doc="/guides/import-traces">Import traces</Docs>.
    </p>
    <p>
      Pick a sample that looks like your traffic, not only the cases that went wrong. A set made only of past failures tells you about past failures.
    </p>

    <h2>Let two teachers answer, and look where they disagree</h2>
    <p>
      Labelling every case by hand is slow. Labelling every case with one model copies that model&apos;s mistakes into your answers. A middle path: ask two teacher models from different families to answer every input, and send only their disagreements to a person.
    </p>
    <CodeBlock title="label.py">{LABEL}</CodeBlock>
    <ul>
      <li>
        Each teacher is your own function from input to answer. <Code>same_answer</Code> decides when two answers count as the same, for example after parsing JSON.
      </li>
      <li>Every answer on the item is compared, including the one recorded from production.</li>
      <li>An item already accepted or corrected by a person is never asked again.</li>
    </ul>
    <p>
      Agreement is not proof. Two models can agree on the same wrong answer. But disagreement is a cheap, reliable pointer to the cases that need a human, and it keeps the review queue short enough to finish.
    </p>
    <Note>
      If you will also train on these answers, check that each teacher provider&apos;s terms allow training on its outputs before you pick it.
    </Note>

    <h2>Send disagreements to people</h2>
    <CodeBlock title="Terminal">{REVIEW}</CodeBlock>
    <p>
      Items whose answers differ go to the <Docs doc="/dashboard/review">review queue</Docs>. Items whose answers agree are stored as not needing review. A human decision is never overwritten by a later push.
    </p>
    <p>A reviewer sees the answers side by side and has two ways to settle an item:</p>
    <ul>
      <li>
        <strong>Correct</strong> stores the answer they write as the item&apos;s final answer.
      </li>
      <li>
        <strong>Accept</strong> marks the item as decided, but does not record which answer was right.
      </li>
    </ul>
    <p>
      Only <strong>Correct</strong> stores an answer. Use it for every item you want in the golden set.
    </p>

    <h2>Make it a versioned dataset</h2>
    <p>
      Create a dataset on the <Docs doc="/dashboard/datasets">Datasets</Docs> page and add the corrected items. Read them with <Code>{"GET /v1/tasks/{slug}/dataset-items?state=corrected"}</Code>, then import them, mapping <Code>input</Code> to Input, <Code>finalOutput</Code> to Expected and <Code>inputHash</Code> to Case id. There is no button that copies labelled items into a case dataset yet.
    </p>
    <p>
      Every change writes a new version and old versions stay readable. When a reviewer finds a mistake, edit the case and the change is recorded in that row&apos;s history.
    </p>
    <p>
      Export the set as benchmark JSONL and commit it next to the task spec. The file has the same version hash as in the dashboard, and a pull request that changes the set is reviewed like code. See <Docs doc="/concepts/benchmarks-and-history">Benchmarks, datasets and history</Docs>.
    </p>

    <h2>Keep it out of training</h2>
    <p>
      If you also train a model on the same traces, the golden cases must stay out of the training split. Otherwise the student is graded on questions it has already seen, and the score means little.
    </p>
    <CodeBlock title="split.py">{SPLIT}</CodeBlock>
    <p>
      <Code>exclude</Code> matches input hashes and source ids. If an excluded item lands in <Code>train</Code>, <Code>split</Code> raises <Code>LeakageError</Code> rather than carrying on. Using <Code>inputHash</Code> as the case id makes the golden ids easy to pass.
    </p>

    <h2>Accept a baseline</h2>
    <p>Score the model you run today on the set, record the run, and accept it:</p>
    <CodeBlock title="Terminal">{ACCEPT}</CodeBlock>
    <p>
      From then on, each candidate runs on the same set and is compared with the baseline case by case. Runs are only compared when they ran on the same version of the set. When you add cases, record and accept a new baseline on the new version.
    </p>
    <p>
      That baseline is what the release gate holds every change to. <Post slug="llm-eval-framework-release-decision">What an LLM eval framework should decide</Post> covers what the gate checks, and <Post slug="llm-as-a-judge-check-against-people">the judge post</Post> uses the same human labels to check an LLM judge.
    </p>
    <div className="docs-cards">
      <DocsCard doc="/guides/golden-dataset" title="Golden dataset guide">
        Every step with the exact commands and API calls.
      </DocsCard>
      <DocsCard doc="/guides/import-traces" title="Import traces">
        Langfuse, Braintrust, OpenTelemetry, LiteLLM and JSONL.
      </DocsCard>
    </div>
  </>
);
