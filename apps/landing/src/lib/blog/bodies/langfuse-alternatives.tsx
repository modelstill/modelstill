import { Code, Docs, DocsCard, Note, Table } from "@/components/blog/body-kit";

export const body = (
  <>
    <p>
      Langfuse is an open-source AI engineering platform, and it has the most GitHub stars of any tool in this post. Teams still look at alternatives for good reasons: a different licence, a gateway instead of an SDK, a tool that starts from evals, or a step that decides releases. This post sorts the options by the need behind the search.
    </p>
    <Note>
      We build ModelStill, so we&apos;ve marked where it fits and where it doesn&apos;t. ModelStill does not replace Langfuse. It reads Langfuse traces, so we list it as a complement at the end.
    </Note>

    <h2>How we checked</h2>
    <p>
      Licences and star counts come from the GitHub API (<Code>gh api repos/OWNER/REPO</Code>) on 26 Nov 2026. Features come from each project&apos;s README or official docs, read the same day. We give no prices. If we could not confirm a detail, it is not here.
    </p>

    <h2>What Langfuse does well</h2>
    <p>
      Be clear on what you would give up. <a href="https://github.com/langfuse/langfuse">Langfuse</a> (37,872 GitHub stars as of 26 Nov 2026) puts these in one place:
    </p>
    <ul>
      <li>tracing built on OpenTelemetry, for LLM calls, retrieval and agent steps;</li>
      <li>prompt management with versions and a playground;</li>
      <li>evaluations: LLM-as-a-judge, code evaluators, user feedback, manual labelling, and datasets with experiments;</li>
      <li>custom dashboards and a metrics API, and an AI gateway in beta;</li>
      <li>an OpenAPI spec, typed Python and JS/TS SDKs, and a CLI.</li>
    </ul>
    <p>
      You can use Langfuse Cloud or <a href="https://langfuse.com/self-hosting">self-host</a> it with Docker Compose and other options. Code outside the enterprise (<Code>ee/</Code>) directories is MIT. Its README says Langfuse has been part of ClickHouse since January 2026. If that list matches your needs, Langfuse may already be the right tool.
    </p>

    <h2>At a glance</h2>
    <Table
      head={["Need", "Tools", "Licence"]}
      rows={[
        ["Self-hosted tracing and evals", "Opik, Arize Phoenix, Laminar", "Apache-2.0, Elastic License 2.0, Apache-2.0"],
        ["Logging through a gateway", "Helicone", "Apache-2.0"],
        ["Keep your OpenTelemetry stack", "OpenLLMetry, MLflow tracing", "Apache-2.0, Apache-2.0"],
        ["A hosted platform", "LangSmith, Braintrust", "Hosted services"],
        ["Evals in code and CI", "promptfoo, DeepEval", "MIT, Apache-2.0"],
        ["A release gate next to Langfuse", "ModelStill", "Apache-2.0"],
      ]}
    />

    <h2>Self-hosted tracing and evals</h2>

    <h3>Opik</h3>
    <p>
      <a href="https://github.com/comet-ml/opik">Opik</a> from Comet (23,519 stars as of 26 Nov 2026) traces LLM calls and agents, runs datasets and experiments with LLM-as-a-judge metrics, and monitors production with dashboards and online rules. Its README says the whole platform is Apache-2.0 and free to self-host, with Docker Compose or Helm.
    </p>
    <p>
      <strong>Choose it if</strong> you want an Apache-2.0 licence across the whole platform.
    </p>

    <h3>Arize Phoenix</h3>
    <p>
      <a href="https://github.com/Arize-ai/phoenix">Phoenix</a> (12,435 stars as of 26 Nov 2026) pairs OpenTelemetry-based tracing with evals, datasets, experiments and a playground. It starts with <Code>phoenix serve</Code> on a laptop and also runs in Docker or Kubernetes. Its licence is the Elastic License 2.0: you can run it yourself, but not offer it to others as a hosted service.
    </p>
    <p>
      <strong>Choose it if</strong> you want to start locally or in a notebook.
    </p>

    <h3>Laminar</h3>
    <p>
      <a href="https://github.com/lmnr-ai/lmnr">Laminar</a> (3,523 stars as of 26 Nov 2026) is an Apache-2.0 observability platform built for AI agents and written in Rust. It has OpenTelemetry-native tracing, evals you run locally or in CI, dashboards with SQL, and &quot;signals&quot; that watch agent runs for behaviour you describe in plain English. Its README covers self-hosting with Docker Compose and a managed platform.
    </p>
    <p>
      <strong>Choose it if</strong> you mostly trace agents.
    </p>

    <h2>Logging through a gateway: Helicone</h2>
    <p>
      <a href="https://github.com/Helicone/helicone">Helicone</a> (6,293 stars as of 26 Nov 2026) is an AI gateway and observability platform under Apache-2.0. You point your OpenAI-compatible client at it, and every call is logged with cost and latency, with routing and fallbacks on top. Its README documents self-hosting with Docker Compose.
    </p>
    <p>
      <strong>Choose it if</strong> you would rather change one base URL than add instrumentation.
    </p>

    <h2>Keep your OpenTelemetry stack</h2>
    <p>
      <a href="https://github.com/traceloop/openllmetry">OpenLLMetry</a> (Apache-2.0, 7,557 stars as of 26 Nov 2026) adds OpenTelemetry instrumentations for LLM providers and vector databases and sends standard spans to your existing backend. <a href="https://mlflow.org/docs/latest/genai/tracing/">MLflow tracing</a> (MLflow is Apache-2.0, 28,977 stars as of 26 Nov 2026) is built on OpenTelemetry too and suits teams that already run MLflow.
    </p>
    <p>
      <strong>Choose them if</strong> you do not want another backend to run.
    </p>

    <h2>A hosted platform: LangSmith or Braintrust</h2>
    <p>
      <a href="https://docs.langchain.com/langsmith/self-hosted">LangSmith</a> is LangChain&apos;s platform for observability, evaluation and prompt engineering. Its docs say self-hosting is an add-on to the Enterprise plan. <a href="https://docs.braintrust.dev/">Braintrust</a> describes itself as &quot;the observability agent, built on Brainstore, the observability database&quot;: it records requests, model and tool calls, cost and latency, and turns them into datasets and evals. Its <a href="https://docs.braintrust.dev/guides/self-hosting">self-hosting docs</a> describe running the data plane in your own cloud while Braintrust hosts the control plane.
    </p>
    <p>
      <strong>Choose them if</strong> you would rather not run the platform yourself.
    </p>

    <h2>Evals in code and CI: promptfoo or DeepEval</h2>
    <p>
      If what you need most is tests, not traces, start from an eval tool. <a href="https://github.com/promptfoo/promptfoo">promptfoo</a> (MIT, 27,701 stars as of 26 Nov 2026) runs evals and red teaming from a declarative config, locally and in CI. <a href="https://github.com/confident-ai/deepeval">DeepEval</a> (Apache-2.0, 19,679 stars as of 26 Nov 2026) works like Pytest for LLM apps, with many ready metrics. Both can sit next to Langfuse rather than replace it.
    </p>

    <h2>A release gate next to Langfuse: ModelStill</h2>
    <p>
      ModelStill is not an alternative to Langfuse. It has no tracing, prompt management or live dashboards. It does one thing after the traces exist: decide whether a prompt or model change may ship.
    </p>
    <ul>
      <li>
        <Code>modelstill ingest langfuse</Code> reads generations through Langfuse&apos;s public API, from Langfuse Cloud or your own host, with read-only <Code>GET</Code> requests. See the <Docs doc="/integrations/langfuse">Langfuse integration</Docs>.
      </li>
      <li>
        People review those cases into a golden set. Each change is compared with the accepted baseline case by case, with an interval on every score (<Docs doc="/reference/statistics">statistics</Docs>).
      </li>
      <li>
        The gate runs in CI and posts its verdict on the pull request with a <Docs doc="/integrations/github-action">GitHub Action</Docs>. ModelStill is Apache-2.0 and self-hosted, with no account.
      </li>
    </ul>
    <p>Keep Langfuse for what happened; add a gate for what ships.</p>

    <div className="docs-cards">
      <DocsCard doc="/integrations/langfuse" title="Read Langfuse traces">
        Pull generations into a ModelStill dataset.
      </DocsCard>
      <DocsCard doc="/guides/ci-gate" title="Gate in CI">
        Pass or fail each change against the baseline.
      </DocsCard>
    </div>
  </>
);
