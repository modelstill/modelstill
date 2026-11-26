# Security policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue or pull request for them.

Use GitHub's private vulnerability reporting for this repository: open the **Security** tab and
choose **Report a vulnerability**.

Include what you can of:

- the affected component (library, API, dashboard, MCP server, LiteLLM plugin) and version or commit;
- how to reproduce the issue;
- what an attacker could do with it.

We aim to acknowledge a report within five working days and to tell you whether we can reproduce
it. Please give us a reasonable time to fix an issue before disclosing it.

## Scope

ModelStill is self-hosted. Issues in your own deployment's configuration, in third-party
dependencies, or in model providers are out of scope, though we are glad to hear about
dependency problems that affect a default installation.

## Handling secrets and data

- Never include API keys, tokens, prompts or customer data in an issue, a pull request or a test.
- The repository is scanned for secrets in CI. If you find one, report it as a vulnerability.
