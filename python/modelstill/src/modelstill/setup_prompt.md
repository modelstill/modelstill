Set up ModelStill in this repository. Work from the source code only. Do not run the application, do not read secret files (.env files, keys, credential stores) and never write a secret into the repository; refer to secrets by environment variable name.

1. Read the ModelStill skill at {skill}.
2. Find every LLM call in this codebase: the file, the model, the prompt and the shape of the answer.
3. Pick the narrowest, busiest call. Add tasks/<task>/spec.yaml for it, with its prompt and output schema next to it, as the skill's "Task spec" section describes. Run `modelstill spec validate tasks/<task>/spec.yaml` until it passes.
4. Wire recording. If the app calls models through LiteLLM, add the ModelStill LiteLLM plugin in mode `off` as the skill's "Rollout through LiteLLM" section describes. Otherwise record runs to a history file as its "Benchmarks and comparisons" section describes.
5. Add the pull-request workflow from the skill's "CI gate" section. It runs `modelstill report gate` and needs no secret beyond GITHUB_TOKEN.
6. Stop. Summarise what you changed and what the team must still decide: teachers, judge and gate thresholds. Do not commit or push.
