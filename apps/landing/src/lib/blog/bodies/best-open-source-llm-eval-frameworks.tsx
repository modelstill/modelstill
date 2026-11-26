import { Code, Docs, DocsCard, Note, Post, Table } from "@/components/blog/body-kit";

export const body = (
  <>
    <p>
      There are many open-source LLM eval frameworks now, and they do different jobs. Some test an app like a unit test suite. Some score retrieval. Some benchmark a model on public tasks. Some live inside a tracing platform. This post groups ten of them by the job they do best, so you can pick by need rather than by popularity.
    </p>
    <Note>
      We build ModelStill, so we&apos;ve marked where it fits and where it doesn&apos;t. The groups below are ordered by job, not by preference.
    </Note>

    <h2>How we checked</h2>
    <p>
      Every licence, language and star count below comes from the GitHub API (<Code>gh api repos/OWNER/REPO</Code>) on 26 Nov 2026. What each tool does comes from its own README or official docs, read the same day. Star counts move daily, so read them as a rough sign of community size, not of quality. Where we could not confirm something, we left it out.
    </p>

    <h2>At a glance</h2>
    <Table
      head={["Framework", "Best for", "Licence", "Main language", "GitHub stars (as of 26 Nov 2026)"]}
      rows={[
        ["promptfoo", "Testing prompts and apps from a config file, in CI", "MIT", "TypeScript", "27,701"],
        ["DeepEval", "Pytest-style unit tests for LLM apps", "Apache-2.0", "Python", "19,679"],
        ["Ragas", "Metrics and test data generation for LLM apps", "Apache-2.0", "Python", "16,434"],
        ["lm-evaluation-harness", "Few-shot benchmarks of language models", "MIT", "Python", "14,539"],
        ["Inspect", "Model evaluations with tools, agents and 200+ ready evals", "MIT", "Python", "3,342"],
        ["OpenAI Evals", "A registry of benchmarks and custom evals", "MIT (LICENSE file)", "Python", "19,807"],
        ["Opik", "Evals next to tracing, self-hosted or managed", "Apache-2.0", "Java", "23,519"],
        ["Phoenix", "Evals next to OpenTelemetry tracing", "Elastic License 2.0", "Python", "12,435"],
        ["autoevals", "A library of scorers", "MIT", "Python", "1,088"],
        ["ModelStill", "A release gate over your own scores, or promptfoo, DeepEval and Inspect results", "Apache-2.0", "Python", "—"],
      ]}
    />
    <p>
      &quot;Main language&quot; is the language GitHub reports for the repository. Opik&apos;s backend is Java, and its README documents a Python SDK. We left out ModelStill&apos;s star count because the repository is new.
    </p>

    <h2>Testing an LLM app: promptfoo and DeepEval</h2>
    <p>These two treat evals like tests: a set of cases, assertions or metrics, and a pass or fail you can run on every change.</p>

    <h3>promptfoo</h3>
    <p>
      <a href="https://github.com/promptfoo/promptfoo">promptfoo</a> calls itself &quot;a CLI and library for evaluating and red-teaming LLM-based apps&quot;. You describe prompts, providers and tests in a declarative config and run <Code>promptfoo eval</Code>. Its README says evals run locally, and it documents <a href="https://www.promptfoo.dev/docs/integrations/ci-cd/">CI/CD</a> use and a <a href="https://github.com/promptfoo/promptfoo-action">GitHub Action</a>. The README also says promptfoo is now part of OpenAI and remains open source and MIT licensed.
    </p>
    <p>
      <strong>Best for:</strong> teams that want side-by-side comparisons of prompts and models from a config file, and red teaming in the same tool.
    </p>

    <h3>DeepEval</h3>
    <p>
      <a href="https://github.com/confident-ai/deepeval">DeepEval</a> describes itself as &quot;similar to Pytest but specialized for unit testing LLM apps&quot;. It ships many ready metrics, such as G-Eval, answer relevancy and hallucination, built on LLM-as-a-judge and other NLP models, and it can evaluate single agent steps as well as whole runs. The same team runs Confident AI, a platform for production traces. Red teaming now lives in DeepEval too, as <Code>deepeval.red_team</Code>.
    </p>
    <p>
      <strong>Best for:</strong> Python teams who want many ready-made metrics and a test-runner feel.
    </p>

    <h2>Retrieval and test data: Ragas</h2>
    <p>
      <a href="https://github.com/vibrantlabsai/ragas">Ragas</a> (the repository is now under vibrantlabsai) offers LLM-based and traditional metrics and generates test sets when you do not have one. Its README says it works with LangChain and with observability tools. The <a href="https://docs.ragas.io/">docs</a> have the metric list.
    </p>
    <p>
      <strong>Best for:</strong> scoring retrieval-augmented apps and bootstrapping a first test set.
    </p>

    <h2>Benchmarking models: lm-evaluation-harness, Inspect and OpenAI Evals</h2>
    <p>These start from the model rather than from your app: many tasks, run the same way on many models.</p>

    <h3>lm-evaluation-harness</h3>
    <p>
      EleutherAI&apos;s <a href="https://github.com/EleutherAI/lm-evaluation-harness">lm-evaluation-harness</a> is &quot;a framework for few-shot evaluation of language models&quot;. It runs a large catalogue of benchmark tasks, including the Open LLM Leaderboard tasks, against Hugging Face, vLLM, SGLang or API models. Since 2025 the base install no longer pulls in <Code>torch</Code>; backends are extras.
    </p>
    <p>
      <strong>Best for:</strong> comparing base or fine-tuned models on public benchmarks.
    </p>

    <h3>Inspect</h3>
    <p>
      <a href="https://github.com/UKGovernmentBEIS/inspect_ai">Inspect</a> was created by the UK AI Security Institute. Its README lists built-in support for prompt engineering, tool use, multi-turn dialogue and model-graded evaluations, plus a collection of over 200 pre-built evaluations. The <a href="https://inspect.aisi.org.uk/">docs</a> cover the rest.
    </p>
    <p>
      <strong>Best for:</strong> model and agent evaluations built from reusable parts, and running ready-made evals.
    </p>

    <h3>OpenAI Evals</h3>
    <p>
      <a href="https://github.com/openai/evals">OpenAI Evals</a> is a framework for evaluating LLMs and an open registry of benchmarks. Its README now points to running evals in the OpenAI Dashboard, and the repository&apos;s last push was on 14 Apr 2026. GitHub shows its licence as unrecognised; the LICENSE file is MIT.
    </p>
    <p>
      <strong>Best for:</strong> reusing its registry of eval designs, or teams already on the OpenAI platform.
    </p>

    <h2>Evals inside a tracing platform: Opik and Phoenix</h2>
    <p>Both pair evals with traces, so you can turn production calls into datasets and score them in one place.</p>

    <h3>Opik</h3>
    <p>
      <a href="https://github.com/comet-ml/opik">Opik</a>, from Comet, covers tracing, datasets, experiments, LLM-as-a-judge metrics and production monitoring. Its README says the full platform is Apache-2.0 and free to self-host, with Docker Compose and Helm options, and it has a PyTest integration for CI.
    </p>
    <p>
      <strong>Best for:</strong> one self-hosted platform for traces and evals.
    </p>

    <h3>Phoenix</h3>
    <p>
      Arize&apos;s <a href="https://github.com/Arize-ai/phoenix">Phoenix</a> offers OpenTelemetry-based tracing, LLM evals, versioned datasets, experiments and a prompt playground. It runs locally with <Code>phoenix serve</Code> or in Docker and Kubernetes. Its licence is the Elastic License 2.0, which lets you use and self-host it but not offer it to others as a hosted service. Arize also sells a managed product, Arize AX.
    </p>
    <p>
      <strong>Best for:</strong> notebook-friendly tracing and evals on your own machine.
    </p>

    <h2>Scorers as a library: autoevals</h2>
    <p>
      <a href="https://github.com/braintrustdata/autoevals">autoevals</a>, from the Braintrust team, bundles LLM-as-a-judge, heuristic (such as Levenshtein distance) and statistical (such as BLEU) scorers for Python and TypeScript. It is a library, not a runner, so it fits inside any of the tools above.
    </p>
    <p>
      <strong>Best for:</strong> adding ready scorers to your own harness.
    </p>

    <h2>The release decision: ModelStill</h2>
    <p>
      ModelStill does a narrower job than most tools here. It does not ship a metric library or a benchmark catalogue. It takes per-case scores and decides whether a change may ship: it compares the candidate with an accepted baseline case by case, puts an interval on every score and fails the gate when the lower bound shows a regression. See <Post slug="llm-eval-framework-release-decision">what an eval framework should decide</Post> for the reasoning, and the <Docs doc="/reference/statistics">statistics reference</Docs> for the maths.
    </p>
    <ul>
      <li>
        <strong>Where it fits:</strong> after the tools above. It <Docs doc="/integrations/eval-tools">records DeepEval, Inspect and promptfoo results as runs</Docs>, keeping their verdicts, and gates them in CI with a <Docs doc="/integrations/github-action">GitHub Action</Docs>. It is Apache-2.0 and self-hosted.
      </li>
      <li>
        <strong>Where it doesn&apos;t:</strong> it has no built-in RAG metrics, no catalogue of public benchmarks and no scoring of multi-step agent trajectories. It is not on PyPI yet, and there is no hosted version. The <Docs doc="/faq">FAQ</Docs> lists the gaps.
      </li>
    </ul>

    <h2>How to choose</h2>
    <ul>
      <li>
        <strong>You test an app on every pull request:</strong> promptfoo or DeepEval.
      </li>
      <li>
        <strong>You build retrieval:</strong> Ragas, alone or inside another runner.
      </li>
      <li>
        <strong>You compare models on public tasks:</strong> lm-evaluation-harness or Inspect.
      </li>
      <li>
        <strong>You want traces and evals in one self-hosted place:</strong> Opik or Phoenix.
      </li>
      <li>
        <strong>You already have scores and need a yes or no per release:</strong> add a gate such as ModelStill on top.
      </li>
    </ul>
    <p>Most teams end up with two: one tool that produces scores and one place that decides what to do with them.</p>

    <div className="docs-cards">
      <DocsCard doc="/integrations/eval-tools" title="Import eval results">
        Record DeepEval, Inspect and promptfoo results as runs.
      </DocsCard>
      <DocsCard doc="/guides/ci-gate" title="Gate in CI">
        Fail a pull request when the change regresses.
      </DocsCard>
    </div>
  </>
);
