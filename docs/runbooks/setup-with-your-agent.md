# Set up ModelStill with your coding agent

Code: `python/modelstill/src/modelstill/setup.py`; the prompt is package data in
`python/modelstill/src/modelstill/setup_prompt.md`. The command hands a fixed prompt to your
coding agent, so the agent does the wiring and you review the diff.

## Use

Run it at the root of the application's repository, with `modelstill` installed:

```bash
modelstill setup                  # print the prompt, the default (--agent print)
modelstill setup --agent claude   # claude -p --permission-mode acceptEdits "<prompt>"
modelstill setup --agent codex    # codex exec --sandbox workspace-write "<prompt>"
```

`--agent claude` and `--agent codex` launch the agent headless only when that binary is on the
PATH. Otherwise the command says so on stderr and prints the prompt to paste. `setup` itself
writes no file, asks for no key and contacts nothing.

## What the prompt asks the agent to do

1. Read the bundled `SKILL.md`; the prompt carries its installed path.
2. Find the application's LLM calls: file, model, prompt and answer shape.
3. Add `tasks/<task>/spec.yaml` for the narrowest, busiest call, with its prompt and output schema,
   and run `modelstill spec validate` on it until it passes.
4. Wire recording: the ModelStill LiteLLM plugin in mode `off` if the app goes through LiteLLM,
   otherwise run history files.
5. Add the pull-request gate workflow from the skill's "CI gate" section
   ([ci-gate.md](ci-gate.md)).
6. Stop and list what it changed and what the team still decides (teachers, judge, thresholds).
   No commit, no push.

It must not run the application, read secret files (`.env`, keys, credential stores) or write a
secret into the repository; secrets are referred to by environment variable name.

## Why these flags

- `claude -p` runs once and exits. `--permission-mode acceptEdits` lets it edit files but still
  asks before shell commands, so it cannot start the application unattended. In headless mode
  that also denies `modelstill spec validate`; run it yourself afterwards.
- `codex exec --sandbox workspace-write` can write only inside the repository and has no network
  by default.
- Review the diff before committing. The spec's teachers, judge and gate thresholds are
  placeholders until the team picks them.

## Changing the prompt

Keep it under 250 words and name only commands that exist. `tests/test_setup.py` checks both,
checks that it points at the bundled skill and its "CI gate" section, and that `setup` writes
nothing. `tests/test_skill.py` checks every command and the action path the skill names.
