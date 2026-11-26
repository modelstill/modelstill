# ModelStill inside a LiteLLM proxy

These files add the ModelStill plugin to a LiteLLM proxy your application already uses. Apply them
once a student has passed its gate (ADR 0007).

## Files

| File | Goes to |
|---|---|
| `Dockerfile` | the LiteLLM image: `litellm-database:v1.101.0` plus the ModelStill wheel |
| `modelstill_handler.py` | next to `config.yaml` in the LiteLLM config |
| `plugin.yaml` | LiteLLM config; `MODELSTILL_LITELLM_CONFIG` names it |
| `deployment.technographics.yaml` | LiteLLM config; edited for rollout (off, shadow, serve) |

The example task here is called `technographics`. Replace it with your task's name.

## Changes to the proxy, in order

1. **Image.** Build and push the image from `Dockerfile`, and use it in place of
   `ghcr.io/berriai/litellm-database:v1.101.0`. Pin it by digest.
2. **Environment:**
   - `MODELSTILL_LITELLM_CONFIG`
   - `MODELSTILL_STUDENT_KEY`
   - `MODELSTILL_CLICKHOUSE_PASSWORD` (a user that writes `modelstill.*` only)
3. **LiteLLM `config.yaml`:**
   - rename the task's existing deployment to `<task>-cloud`, keeping its params and `model_info`;
   - add `<task>` with `litellm_params: { model: modelstill/<task> }` and the same `model_info`;
   - keep your existing fallback for `<task>` and add the same fallback for `<task>-cloud`;
   - add `custom_provider_map` under `litellm_settings`.
4. **Start in `mode: off`.** The cloud model answers as before; calls are only logged. Check that
   the reported cost per call is unchanged, and that rows arrive in `modelstill.serving_events`.
5. **Then `mode: shadow` with `shadow_sample: 0.1`.** Watch the traffic screen for a week. Use
   `serve` only after the gate and the shadow comparison pass.

**Optional, API-driven mode:** add an `api` block to `plugin.yaml` (`url`, `token_file` or
`token_env` holding a read API key) and the plugin follows the task's API deployment record, which
wins over the file while the API answers. See `docs/runbooks/serving-and-monitoring.md`,
"Changing the mode from the API".

**Rollback:** set `mode: off` (within 30 s), in the API record when the `api` block is set,
otherwise in the deployment file. To remove the plugin entirely, point `<task>` back at the cloud
deployment.
