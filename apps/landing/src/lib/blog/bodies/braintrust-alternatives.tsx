import { Code, Docs, DocsCard, Note, Table } from "@/components/blog/body-kit";

export const body = (
  <>
    <p>
      Braintrust is a hosted platform for logging LLM calls and running evals on them. Teams look at alternatives when they want the whole platform on their own servers, an open-source licence, evals that live only in code, or a release gate they run themselves. This post sorts the options by that need.
    </p>
    <Note>
      We build ModelStill, so we&apos;ve marked where it fits and where it doesn&apos;t. ModelStill can read Braintrust data, so it can replace one part of a Braintrust workflow or sit next to it. We say which below.
    </Note>

    <h2>How we checked</h2>
    <p>
      Licences and star counts come from the GitHub API (<Code>gh api repos/OWNER/REPO</Code>) on 26 Nov 2026. Features come from each project&apos;s README or official docs, read the same day. We give no prices. If we could not confirm a detail, we left it out.
    </p>

    <h2>What Braintrust does well</h2>
    <p>
      The <a href="https://docs.braintrust.dev/">Braintrust docs</a> describe it as &quot;the observability agent, built on Brainstore, the observability database&quot;. In practice that covers:
    </p>
    <ul>
      <li>logging requests, model and tool calls, outputs, cost and latency;</li>
      <li>turning failures and good requests into datasets, then building evals on them;</li>
      <li>human review to set expected behaviour, and scorers to measure it;</li>
      <li>
        <a href="https://github.com/braintrustdata/autoevals">autoevals</a>, an MIT library of LLM-as-a-judge, heuristic and statistical scorers for Python and TypeScript (1,088 GitHub stars as of 26 Nov 2026);
      </li>
      <li>
        <a href="https://github.com/braintrustdata/eval-action">a GitHub Action</a> that runs Braintrust evals and posts a summary on the pull request.
      </li>
    </ul>
    <p>
      For data that must stay in your cloud, its <a href="https://docs.braintrust.dev/guides/self-hosting">self-hosting docs</a> describe running the data plane in your own infrastructure with Terraform, while Braintrust hosts the control plane: the web UI, authentication and metadata. If a managed service suits you, that is a strong set of features to give up.
    </p>

    <h2>At a glance</h2>
    <Table
      head={["Need", "Tools", "Licence", "GitHub stars (as of 26 Nov 2026)"]}
      rows={[
        ["The whole platform on your servers", "Langfuse, Opik, Arize Phoenix", "MIT outside enterprise directories, Apache-2.0, Elastic License 2.0", "37,872, 23,519, 12,435"],
        ["Evals in code and CI", "promptfoo, DeepEval, Inspect", "MIT, Apache-2.0, MIT", "27,701, 19,679, 3,342"],
        ["Another hosted platform", "LangSmith", "Hosted service; SDK is MIT", "—"],
        ["A self-hosted release gate", "ModelStill", "Apache-2.0", "—"],
      ]}
    />

    <h2>The whole platform on your servers</h2>

    <h3>Langfuse</h3>
    <p>
      <a href="https://github.com/langfuse/langfuse">Langfuse</a> covers tracing (built on OpenTelemetry), prompt management, evaluations with datasets and experiments, and dashboards. It runs as Langfuse Cloud or <a href="https://langfuse.com/self-hosting">self-hosted</a>, starting with Docker Compose. Code outside its enterprise directories is MIT.
    </p>
    <p>
      <strong>Choose it if</strong> you want the closest open-source match to a logging-plus-evals platform.
    </p>

    <h3>Opik</h3>
    <p>
      <a href="https://github.com/comet-ml/opik">Opik</a>, from Comet, has tracing, datasets, experiments, LLM-as-a-judge metrics, production dashboards and a PyTest integration for CI. Its README says the full platform is Apache-2.0 and free to self-host.
    </p>
    <p>
      <strong>Choose it if</strong> you want one Apache-2.0 licence across the platform.
    </p>

    <h3>Arize Phoenix</h3>
    <p>
      <a href="https://github.com/Arize-ai/phoenix">Phoenix</a> has OpenTelemetry-based tracing, evals, versioned datasets, experiments and a playground. It runs locally or in Docker and Kubernetes. The Elastic License 2.0 lets you run it yourself but not resell it as a hosted service.
    </p>
    <p>
      <strong>Choose it if</strong> you want to start on a laptop and grow into a deployment.
    </p>

    <h2>Evals in code and CI</h2>
    <p>If what you use Braintrust for is mostly experiments on a fixed dataset, a code-first eval tool may be enough.</p>
    <ul>
      <li>
        <a href="https://github.com/promptfoo/promptfoo">promptfoo</a>: declarative configs, side-by-side model comparison, red teaming, and a <a href="https://github.com/promptfoo/promptfoo-action">GitHub Action</a>. Its README says evals run locally.
      </li>
      <li>
        <a href="https://github.com/confident-ai/deepeval">DeepEval</a>: Pytest-style tests for LLM apps with many ready metrics. Its team also runs Confident AI, a hosted platform.
      </li>
      <li>
        <a href="https://github.com/UKGovernmentBEIS/inspect_ai">Inspect</a>: from the UK AI Security Institute, with tool use, multi-turn dialogue, model-graded scoring and over 200 ready evals.
      </li>
    </ul>

    <h2>Another hosted platform: LangSmith</h2>
    <p>
      <a href="https://docs.langchain.com/langsmith/self-hosted">LangSmith</a> is LangChain&apos;s platform for observability, evaluation and prompt engineering. Its docs say self-hosting is an add-on to the Enterprise plan.
    </p>
    <p>
      <strong>Choose it if</strong> you build on LangChain and want a managed service.
    </p>

    <h2>A self-hosted release gate: ModelStill</h2>
    <p>
      ModelStill covers one part of what Braintrust does: deciding whether an experiment is good enough to ship. It is Apache-2.0 and self-hosted, with no account, and the gate needs no provider key. It does not log production traffic, host a playground or offer a managed UI.
    </p>
    <ul>
      <li>
        <strong>Read Braintrust data.</strong> <Code>modelstill ingest braintrust</Code> reads project logs or a dataset into a ModelStill dataset, from an export file or the REST API. The reader only calls the fetch endpoints. See the <Docs doc="/integrations/braintrust">Braintrust integration</Docs>.
      </li>
      <li>
        <strong>Record experiments as runs.</strong> <Code>modelstill import braintrust --experiment-id</Code> turns a Braintrust experiment into a run, keeping the score you pick, and averages trials into one case.
      </li>
      <li>
        <strong>Compare and gate.</strong> Two experiments over the same dataset pair case by case. The gate reads intervals, checks cost and latency, and posts a verdict on the pull request through a <Docs doc="/integrations/github-action">GitHub Action</Docs>.
      </li>
    </ul>
    <p>
      So you can keep Braintrust for logging and experiments and add a gate you run yourself, or move the release decision out of a hosted service entirely.
    </p>

    <h2>How to choose</h2>
    <ul>
      <li>
        <strong>You want everything self-hosted:</strong> Langfuse, Opik or Phoenix. Check which licence suits you.
      </li>
      <li>
        <strong>You mostly run experiments from code:</strong> promptfoo, DeepEval or Inspect.
      </li>
      <li>
        <strong>You are happy with hosted, and use LangChain:</strong> LangSmith.
      </li>
      <li>
        <strong>You want a release decision you own:</strong> ModelStill, with or without Braintrust.
      </li>
    </ul>

    <div className="docs-cards">
      <DocsCard doc="/integrations/braintrust" title="Read Braintrust data">
        Ingest logs and datasets, and record experiments as runs.
      </DocsCard>
      <DocsCard doc="/guides/ci-gate" title="Gate in CI">
        Pass or fail each change against the baseline.
      </DocsCard>
    </div>
  </>
);
