import { Code, Docs, Note, Table } from "@/components/blog/body-kit";

export const body = (
  <>
    <p>
      AI red teaming means attacking your own model or app before someone else does: prompt injection, jailbreaks, data leakage, harmful output. Open-source tools now automate much of it. This post compares five, grouped by how they work.
    </p>
    <Note>
      We build ModelStill, so we&apos;ve marked where it fits and where it doesn&apos;t. ModelStill is not a red-teaming tool and has no attack library, so it is not in this list.
    </Note>

    <h2>How we checked</h2>
    <p>
      Licences, languages and star counts come from the GitHub API (<Code>gh api repos/OWNER/REPO</Code>) on 26 Nov 2026. What each tool does comes from its README or official docs, read the same day. If we could not confirm a detail, it is not here.
    </p>

    <h2>At a glance</h2>
    <Table
      head={["Tool", "How it works", "From", "Licence", "GitHub stars (as of 26 Nov 2026)"]}
      rows={[
        ["garak", "A scanner: runs probes against a model and scores them with detectors", "NVIDIA", "Apache-2.0", "10,192"],
        ["PyRIT", "A toolkit: scanner, GUI and Python framework, with multi-turn attacks", "Microsoft", "MIT", "5,101"],
        ["promptfoo red teaming", "Adversarial plugins and strategies inside an eval tool, with a report", "promptfoo", "MIT", "27,701"],
        ["Giskard Scan", "Generates adversarial test suites for agents from a description", "Giskard", "Apache-2.0", "5,973"],
        ["DeepEval red teaming", "Simulated attacks and vulnerabilities, formerly DeepTeam", "Confident AI", "Apache-2.0", "19,679"],
      ]}
    />
    <p>
      Stars are for each project&apos;s whole repository. promptfoo&apos;s and DeepEval&apos;s cover their eval features too, so they are not a fair measure of the red-teaming part alone.
    </p>

    <h2>Scanners you point at a model</h2>

    <h3>garak</h3>
    <p>
      <a href="https://github.com/NVIDIA/garak">garak</a>, the &quot;Generative AI Red-teaming &amp; Assessment Kit&quot;, calls itself an LLM vulnerability scanner. It probes for hallucination, data leakage, prompt injection, misinformation, toxic output, jailbreaks and more. Each probe has detectors that judge the answers. It talks to Hugging Face models, the OpenAI API, AWS Bedrock, LiteLLM, GGUF models and most things reachable over REST. You install it with <Code>pip install -U garak</Code> and pick probes with <Code>--spec</Code>. The <a href="https://docs.garak.ai/">user guide</a> lists them.
    </p>
    <p>
      <strong>Best for:</strong> a broad scan of a model or endpoint, the way you would scan a network.
    </p>

    <h3>PyRIT</h3>
    <p>
      <a href="https://github.com/microsoft/PyRIT">PyRIT</a>, the Python Risk Identification Tool, is built by the Microsoft AI Red Team and contributors. It brings together a command-line scanner, a browser GUI called CoPyRIT, and a Python framework for building your own workflows, including adaptive multi-turn attacks. It connects to many model providers and can test whole applications over HTTP, WebSockets or browser automation with Playwright. The project moved from the Azure organisation to <Code>microsoft/PyRIT</Code>; the old repository is archived. Docs are at <a href="https://microsoft.github.io/PyRIT/">microsoft.github.io/PyRIT</a>.
    </p>
    <p>
      <strong>Best for:</strong> security teams who want to compose custom, multi-turn attack workflows.
    </p>

    <h2>Red teaming inside an eval tool</h2>

    <h3>promptfoo red teaming</h3>
    <p>
      <a href="https://github.com/promptfoo/promptfoo">promptfoo</a> is an eval tool with <a href="https://www.promptfoo.dev/docs/red-team/">red teaming</a> built in. Its docs describe breaking failure modes into adversarial testers called plugins, adding strategies, and producing a report that quantifies the risk of misuse. It is the same CLI as promptfoo&apos;s evals, which document <a href="https://www.promptfoo.dev/docs/integrations/ci-cd/">CI/CD</a> use. Its README says promptfoo is now part of OpenAI and remains MIT licensed.
    </p>
    <p>
      <strong>Best for:</strong> teams already using promptfoo for evals, or who want red teaming in CI.
    </p>

    <h3>DeepEval red teaming (formerly DeepTeam)</h3>
    <p>
      <a href="https://github.com/confident-ai/deepteam">DeepTeam</a> simulates attacks such as jailbreaking, prompt injection and multi-turn exploitation to find vulnerabilities like bias, PII leakage and SQL injection, and adds guardrails for production. It has now moved into <a href="https://github.com/confident-ai/deepeval">DeepEval</a> as the <Code>deepeval.red_team</Code> module, and its README says the <Code>deepteam</Code> package will be deprecated on 30 Jan 2027. It runs locally; results can go to Confident AI, the team&apos;s hosted platform.
    </p>
    <p>
      <strong>Best for:</strong> Python teams already on DeepEval.
    </p>

    <h2>Test suites generated for agents: Giskard Scan</h2>
    <p>
      <a href="https://github.com/Giskard-AI/giskard-oss">Giskard</a> v3 is a rewrite for multi-turn testing of AI agents. Its <Code>giskard-scan</Code> package is the red-teaming and vulnerability scanning layer: it generates adversarial test suites from a plain-language description of your agent, covering prompt injection, jailbreaks and harmful content, alongside RAG and quality evaluation. Install it with <Code>pip install &quot;giskard[scan]&quot;</Code>; it needs Python 3.12 or newer. Giskard v2 is still available but no longer actively maintained.
    </p>
    <p>
      <strong>Best for:</strong> agents, when you want the attack suite written for you from a description.
    </p>

    <h2>How to choose</h2>
    <ul>
      <li>
        <strong>You want a quick, broad scan of a model:</strong> garak.
      </li>
      <li>
        <strong>You run a red team and need custom, multi-turn campaigns:</strong> PyRIT.
      </li>
      <li>
        <strong>You want attacks in the same CI as your evals:</strong> promptfoo or DeepEval, whichever you already use.
      </li>
      <li>
        <strong>You test an agent and want suites generated for it:</strong> Giskard Scan.
      </li>
    </ul>
    <p>
      Many teams run more than one: a scanner for breadth, and a fixed set of attacks in CI so a fixed hole stays fixed. ModelStill does no red teaming, but if you keep such a fixed set with a scorer, its gate can compare those scores between releases like any other task; see the <Docs doc="/faq">FAQ</Docs>.
    </p>
  </>
);
