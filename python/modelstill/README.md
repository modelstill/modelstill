# ModelStill

The release gate for LLM changes: an open-source LLM eval framework for CI.

Regression-test every prompt and model change against a golden dataset, score it with exact checks
or an LLM-as-a-judge validated against human labels, and get one pass or fail.

ModelStill compares every model or prompt change with your accepted baseline, case by case, and
tells you whether it is safe to ship. The decision is a paired comparison with confidence
intervals, plus flip rate, cost and p95 latency. Exit code 0 means pass, 2 means fail, so it drops
into any CI job. The package ships a pytest plugin, and the repository has a GitHub Action that
posts the verdict on pull requests.

- Evals with intervals: Clopper-Pearson for binary scores, bootstrap otherwise.
- LLM-as-a-judge and exact-match metrics.
- Datasets from the calls you already log: Langfuse, Braintrust, OpenTelemetry GenAI spans,
  LiteLLM spend logs and JSONL.
- Model swaps: replay recorded calls through a cheaper model and measure agreement.
- Optional distillation into a small model, served behind LiteLLM with the cloud model as fallback.

See the release gate pass and fail on example data, with no API key and no network:

```bash
uv tool install modelstill
modelstill quickstart demo
modelstill report gate demo/history.jsonl 2d1857f9 \
    --spec demo/tasks/ticket-priority-example/spec.yaml \
    --previous 248036ea \
    --flip-rate 0.004 --cost-ratio 0.82 --p95-latency-ms 640
```

Documentation: https://docs.modelstill.com
Source: https://github.com/modelstill/modelstill
Licence: Apache-2.0
