import { Code, Docs, DocsCard, Note, Post, Table } from "@/components/blog/body-kit";

export const body = (
  <>
    <p>
      An LLM observability tool records what your application sent to a model, what came back, how long it took and what it cost. When something goes wrong, the trace shows where. This post compares seven tools by how they collect data and where that data lives.
    </p>
    <Note>
      We build ModelStill, so we&apos;ve marked where it fits and where it doesn&apos;t. ModelStill is not an observability tool, so it is not in the list. It appears only at the end, because it reads the traces these tools collect.
    </Note>

    <h2>How we checked</h2>
    <p>
      Licences and star counts come from the GitHub API (<Code>gh api repos/OWNER/REPO</Code>) on 26 Nov 2026. Features come from each project&apos;s README or official docs, read the same day. We give no prices: plans change, and the vendors&apos; own pages are the place to read them. Where we could not confirm a detail, we left it out.
    </p>

    <h2>Three ways to collect traces</h2>
    <ul>
      <li>
        <strong>An SDK or OpenTelemetry instrumentation</strong> in your code sends spans to a backend. Most tools here work this way, and several are built on OpenTelemetry.
      </li>
      <li>
        <strong>A gateway</strong> sits between your app and the providers, so every call is logged without touching each call site. Helicone works this way, and Langfuse has a gateway in beta.
      </li>
      <li>
        <strong>Instrumentation only</strong>, with no backend of its own: OpenLLMetry emits standard OpenTelemetry data to whatever you already run.
      </li>
    </ul>

    <h2>At a glance</h2>
    <Table
      head={["Tool", "What it is", "Licence", "Self-hosting", "GitHub stars (as of 26 Nov 2026)"]}
      rows={[
        ["Langfuse", "Tracing, prompt management, evals and dashboards", "MIT, except enterprise directories", "Yes, documented", "37,872"],
        ["Arize Phoenix", "OpenTelemetry tracing, evals, datasets and experiments", "Elastic License 2.0", "Yes, documented", "12,435"],
        ["Opik", "Tracing, evals and production monitoring", "Apache-2.0", "Yes, documented", "23,519"],
        ["OpenLLMetry", "OpenTelemetry instrumentation for LLM providers and vector databases", "Apache-2.0", "No server: sends to your OpenTelemetry backend", "7,557"],
        ["Helicone", "AI gateway with logging, sessions and cost tracking", "Apache-2.0", "Yes, with Docker", "6,293"],
        ["LangSmith", "LangChain's platform for observability, evaluation and prompts", "SDK is MIT", "Add-on to the Enterprise plan", "—"],
        ["MLflow tracing", "Tracing inside MLflow, built on OpenTelemetry", "Apache-2.0", "Yes, an MLflow server", "28,977"],
      ]}
    />
    <p>LangSmith has no star count here because the platform itself is not a public repository; its SDKs are.</p>

    <h2>Langfuse</h2>
    <p>
      <a href="https://github.com/langfuse/langfuse">Langfuse</a> is an open-source platform for tracing, prompt management, evaluations, datasets and experiments, with custom dashboards and an AI gateway in beta. Its tracing is built on OpenTelemetry. You can use Langfuse Cloud or <a href="https://langfuse.com/self-hosting">self-host</a> it, starting with Docker Compose. The licence is MIT outside the enterprise (<Code>ee/</Code>) directories. Its README says Langfuse has been part of ClickHouse since January 2026.
    </p>
    <p>
      <strong>Best for:</strong> a full, self-hostable platform where traces, prompts and evals live together.
    </p>

    <h2>Arize Phoenix</h2>
    <p>
      <a href="https://github.com/Arize-ai/phoenix">Phoenix</a> traces your app with OpenTelemetry-based instrumentation and adds evals, versioned datasets, experiments and a playground that can replay traced calls. It runs locally with <Code>phoenix serve</Code>, or in Docker and Kubernetes (<a href="https://arize.com/docs/phoenix/self-hosting">self-hosting docs</a>). The Elastic License 2.0 lets you run it yourself but not offer it to others as a hosted service. Arize sells a managed product, Arize AX.
    </p>
    <p>
      <strong>Best for:</strong> starting on a laptop or in a notebook and keeping OpenTelemetry as the format.
    </p>

    <h2>Opik</h2>
    <p>
      <a href="https://github.com/comet-ml/opik">Opik</a>, from Comet, traces LLM calls and agents, adds datasets and LLM-as-a-judge metrics, and monitors production with dashboards and online evaluation rules. Its README says the full platform is Apache-2.0 and free to self-host, with Docker Compose for local use and Helm for Kubernetes. Comet also runs it as a cloud service.
    </p>
    <p>
      <strong>Best for:</strong> an Apache-2.0 platform that covers tracing and evals without an enterprise split.
    </p>

    <h2>OpenLLMetry</h2>
    <p>
      <a href="https://github.com/traceloop/openllmetry">OpenLLMetry</a>, from Traceloop, is a set of OpenTelemetry extensions: instrumentations for LLM providers and vector databases, and an SDK to set them up. Because the output is standard OpenTelemetry, it goes to any supported destination, including an <a href="https://www.traceloop.com/docs/openllmetry/integrations/otel-collector">OpenTelemetry Collector</a>. If you already use OpenTelemetry, you can add its instrumentations on their own.
    </p>
    <p>
      <strong>Best for:</strong> teams with an observability stack who want LLM spans in it, not a new backend.
    </p>

    <h2>Helicone</h2>
    <p>
      <a href="https://github.com/Helicone/helicone">Helicone</a> is an AI gateway and LLM observability platform. You change the base URL of your OpenAI-compatible client, and calls are logged with cost and latency. It adds sessions for agents, prompt management, routing and fallbacks. Its README describes <a href="https://docs.helicone.ai/">self-hosting</a> with Docker Compose, and a Helm chart for enterprise use on request.
    </p>
    <p>
      <strong>Best for:</strong> logging every call with no instrumentation in your code, plus routing.
    </p>

    <h2>LangSmith</h2>
    <p>
      <a href="https://docs.langchain.com/langsmith/self-hosted">LangSmith</a> is LangChain&apos;s platform for observability, evaluation and prompt engineering. You trace with its SDK (the <a href="https://github.com/langchain-ai/langsmith-python">Python SDK</a> is MIT) by wrapping a client or decorating a function. Its docs say self-hosted LangSmith is an add-on to the Enterprise plan; otherwise it is a hosted service.
    </p>
    <p>
      <strong>Best for:</strong> teams building on LangChain who are happy with a hosted service.
    </p>

    <h2>MLflow tracing</h2>
    <p>
      <a href="https://github.com/mlflow/mlflow">MLflow</a> has <a href="https://mlflow.org/docs/latest/genai/tracing/">tracing</a> for LLM apps and agents, built on OpenTelemetry, with one-line automatic tracing for more than 60 frameworks. Traces sit next to MLflow&apos;s evaluation, prompt registry and experiment tracking. You can connect to your own MLflow server or a Databricks workspace.
    </p>
    <p>
      <strong>Best for:</strong> teams that already run MLflow for classic machine learning.
    </p>

    <h2>How to choose</h2>
    <ul>
      <li>
        <strong>You want one platform and may self-host:</strong> Langfuse, Opik or Phoenix. Read the licences: MIT with an enterprise part, Apache-2.0, and Elastic License 2.0.
      </li>
      <li>
        <strong>You already run OpenTelemetry:</strong> OpenLLMetry into your current backend, or any of the OpenTelemetry-based platforms.
      </li>
      <li>
        <strong>You cannot touch every call site:</strong> a gateway such as Helicone.
      </li>
      <li>
        <strong>You live in LangChain or MLflow already:</strong> LangSmith or MLflow tracing.
      </li>
    </ul>

    <h2>After observability: deciding what ships</h2>
    <p>
      Traces tell you what happened. They do not tell you whether the next prompt or model change is safe to release. That is a different job, and it is the one ModelStill does.
    </p>
    <p>
      ModelStill reads traces you already have into a dataset: <Docs doc="/integrations/langfuse">Langfuse generations</Docs> through its public API, <Docs doc="/integrations/opentelemetry">OpenTelemetry GenAI spans</Docs> from an OTLP JSON export, <Docs doc="/integrations/braintrust">Braintrust logs</Docs> and <Docs doc="/integrations/litellm">LiteLLM spend logs</Docs>. People review those cases into a golden set (see <Post slug="golden-dataset-from-production-traces">building a golden dataset from traces</Post>). Then each change is compared with the accepted baseline case by case, with intervals, and a gate passes or fails it in CI.
    </p>
    <p>
      It does not collect traces, show live dashboards of production calls or replace any tool above. Keep your observability tool; ModelStill sits after it.
    </p>

    <div className="docs-cards">
      <DocsCard doc="/guides/import-traces" title="Import traces">
        Turn Langfuse, OpenTelemetry, Braintrust or LiteLLM data into a dataset.
      </DocsCard>
      <DocsCard doc="/guides/ci-gate" title="Gate in CI">
        Pass or fail each change against the baseline.
      </DocsCard>
    </div>
  </>
);
