import argparse
import json
import os
import sys
from collections.abc import Iterable
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from modelstill import push, report, swap
from modelstill.attest import load_attestation, verify
from modelstill.benchmark import History
from modelstill.client import ChatClient, ChatError
from modelstill.evals import compare
from modelstill.export import FORMATS, OUTTYPES, RemoteExporter, export_peft
from modelstill.gate import decide
from modelstill.ingest import (
    braintrust,
    deepeval,
    inspect_logs,
    jsonl,
    langfuse,
    litellm_logs,
    otel,
    promptfoo,
)
from modelstill.ingest.braintrust import BraintrustError, BraintrustReader
from modelstill.ingest.langfuse import LangfuseError, LangfuseReader
from modelstill.ingest.records import Record, to_items, write_dataset
from modelstill.ingest.runs import (
    ImportedRun,
    gate_run,
    load_gate,
    record_run,
    report_lines,
    run_line,
)
from modelstill.jsonl import jsonl_lines
from modelstill.judges import JudgeError, PairwiseJudge, pairwise_cases, pairwise_compare
from modelstill.monitor.alerts import AlertSink, DiscordAlertSink, LogAlertSink
from modelstill.monitor.api_sink import ApiMonitorSink, api_sink_from
from modelstill.monitor.canary import MonitorConfig, load_monitor_config, run_canary, run_drift
from modelstill.monitor.watch import check_watch, record_baseline
from modelstill.quickstart import write_quickstart
from modelstill.sample import sample
from modelstill.serve.config import write_threshold
from modelstill.serve.host import HostServer
from modelstill.setup import CHOICES, run_setup
from modelstill.sinks import ClickHouseStore, JsonlStore, SinkError, TableStore
from modelstill.spec import load_spec, snapshot_hash
from modelstill.stats import deferral_threshold
from modelstill.train import (
    load_backend,
    load_local_model,
    modal_plan,
    plans_from_spec,
    served_name,
)

DEFAULT_API_URL = "http://localhost:8787"
DEFAULT_LANGFUSE_URL = "https://cloud.langfuse.com"
PAIRWISE_INSTRUCTIONS = "Pick the answer that better does what the input asks."
BRAINTRUST_FLAGS: dict[braintrust.Kind, str] = {
    "project_logs": "--project-id",
    "dataset": "--dataset-id",
    "experiment": "--experiment-id",
}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="modelstill")
    groups = parser.add_subparsers(dest="group", required=True)
    spec = groups.add_parser("spec", help="validate and hash task specs")
    spec_actions = spec.add_subparsers(dest="action", required=True)
    for action in ("validate", "hash"):
        spec_actions.add_parser(action).add_argument("path", type=Path)
    evals = groups.add_parser("eval", help="read and compare recorded runs")
    eval_actions = evals.add_subparsers(dest="action", required=True)
    eval_actions.add_parser("runs").add_argument("history", type=Path)
    comparing = eval_actions.add_parser("compare")
    comparing.add_argument("history", type=Path)
    comparing.add_argument("before")
    comparing.add_argument("after")
    accepting = eval_actions.add_parser("accept")
    accepting.add_argument("history", type=Path)
    accepting.add_argument("run")
    _pairwise_parser(eval_actions)
    _push_parser(groups)
    _report_parser(groups)
    onboarding = groups.add_parser(
        "setup", help="print or hand your coding agent the ModelStill setup prompt"
    )
    onboarding.add_argument("--agent", choices=CHOICES, default="print")
    starting = groups.add_parser(
        "quickstart", help="write an example task and run history to see the gate offline"
    )
    starting.add_argument("directory", type=Path)
    swap.add_parser(groups)
    training = groups.add_parser("train", help="train adapters and run them locally")
    train_actions = training.add_subparsers(dest="action", required=True)
    running = train_actions.add_parser("run")
    running.add_argument("spec", type=Path)
    running.add_argument("--train", type=Path, required=True)
    running.add_argument("--val", type=Path, required=True)
    running.add_argument("--base")
    running.add_argument("--method", choices=("lora", "full", "distill", "grpo"))
    running.add_argument("--modality", choices=("text", "vision"))
    running.add_argument("--quantization", choices=("none", "4bit"), help="4bit is QLoRA")
    running.add_argument("--reward", help="grpo reward: exact_match, json_equal or module:attr")
    running.add_argument(
        "--loss", choices=("grpo", "dr_grpo", "dapo", "bnpo", "cispo"), help="grpo loss"
    )
    running.add_argument("--num-generations", type=int, help="grpo completions per prompt")
    running.add_argument(
        "--max-completion-length", type=int, help="longest sampled answer (distill, grpo)"
    )
    running.add_argument("--importance-level", choices=("token", "sequence"))
    running.add_argument("--teacher", help="teacher model for --method distill")
    running.add_argument("--beta", type=float, help="0 forward KL, 1 reverse KL (distill)")
    running.add_argument("--max-steps", type=int)
    running.add_argument("--max-seq-length", type=int)
    running.add_argument("--learning-rate", type=float)
    running.add_argument("--epochs", type=float)
    running.add_argument("--batch-size", type=int)
    running.add_argument("--gradient-accumulation", type=int)
    running.add_argument("--eval-steps", type=int)
    running.add_argument("--gradient-checkpointing", action="store_true", default=None)
    running.add_argument("--seed", type=int)
    running.add_argument("--output-root", type=Path, default=Path("artifacts"))
    running.add_argument("--backend", default="trl")
    running.add_argument("--gpu", help="Modal GPU type (with --backend modal)")
    running.add_argument("--timeout-minutes", type=int, help="hard stop and spend cap (modal)")
    running.add_argument(
        "--dry-run", action="store_true", help="print the Modal plan and cost; contact nothing"
    )
    running.add_argument("--host", help="SSH host with GPUs (with --backend remote)")
    running.add_argument("--gpus", help="GPU indexes on the host, e.g. 0,1,2 (remote)")
    running.add_argument(
        "--stop-service",
        action="append",
        dest="stop_services",
        help="systemd user service to stop during the run and restart after (remote; repeatable)",
    )
    inferring = train_actions.add_parser("infer")
    inferring.add_argument("artifact", type=Path)
    inferring.add_argument("prompt", help="chat messages as inline JSON or a JSON file path")
    inferring.add_argument("--max-new-tokens", type=int, default=256)
    serve = groups.add_parser("serve", help="calibrate the deferral threshold")
    serve_actions = serve.add_subparsers(dest="action", required=True)
    upping = serve_actions.add_parser("up", help="serve artifacts with vLLM on an SSH GPU host")
    upping.add_argument("artifacts", type=Path, nargs="+")
    upping.add_argument("--host", required=True)
    upping.add_argument("--gpu", default="0")
    upping.add_argument("--port", type=int, default=8100)
    upping.add_argument(
        "--key-file", type=Path, default=Path("~/.config/modelstill/student.key").expanduser()
    )
    upping.add_argument("--stop-service", action="append", dest="stop_services", default=[])
    downing = serve_actions.add_parser("down", help="stop a vLLM server on the host")
    downing.add_argument("--host", required=True)
    downing.add_argument("--port", type=int, default=8100)
    calibrate = serve_actions.add_parser("calibrate")
    calibrate.add_argument("pairs", type=Path, help="JSONL of {confidence, correct}")
    calibrate.add_argument("--target-error", type=float, required=True)
    calibrate.add_argument("--delta", type=float, default=0.05)
    calibrate.add_argument("--deployment", type=Path, required=True)
    sampling = groups.add_parser("sample", help="sample a served model with logprobs")
    sampling.add_argument("model", help="served model name")
    sampling.add_argument("--prompts", type=Path, required=True, help="JSONL of {messages}")
    sampling.add_argument("--out", type=Path, required=True)
    sampling.add_argument("--base-url", default="http://127.0.0.1:8100")
    sampling.add_argument(
        "--key-file", type=Path, default=Path("~/.config/modelstill/student.key").expanduser()
    )
    sampling.add_argument("--top-logprobs", type=int, default=0)
    sampling.add_argument("--temperature", type=float, default=0.0)
    sampling.add_argument("--max-tokens", type=int)
    exporting = groups.add_parser("export", help="export an artifact as PEFT, merged or GGUF")
    exporting.add_argument("artifact", type=Path)
    exporting.add_argument("--to", choices=FORMATS, required=True)
    exporting.add_argument("--out", type=Path, required=True)
    exporting.add_argument("--host", help="SSH GPU host for merged and gguf exports")
    exporting.add_argument("--gpu", default="0")
    exporting.add_argument("--llama-cpp", default="~/Projects/llama.cpp")
    exporting.add_argument("--outtype", choices=OUTTYPES, default="q8_0")
    attest = groups.add_parser("attest", help="check data files against an artifact's attestation")
    attest_actions = attest.add_subparsers(dest="action", required=True)
    verifying = attest_actions.add_parser("verify")
    verifying.add_argument("artifact", type=Path)
    verifying.add_argument("--train", type=Path)
    verifying.add_argument("--val", type=Path)
    _ingest_parser(groups)
    _import_parser(groups)
    monitor = groups.add_parser("monitor", help="canaries and provider drift checks")
    monitor_actions = monitor.add_subparsers(dest="action", required=True)
    for action in ("canary", "drift"):
        checking = monitor_actions.add_parser(action)
        checking.add_argument("config", type=Path)
        checking.add_argument("--fail-on-alert", action="store_true")
        _api_arguments(checking)
    watch = groups.add_parser("watch", help="baseline an endpoint and catch silent model changes")
    watch_actions = watch.add_subparsers(dest="action", required=True)
    baseline = watch_actions.add_parser("baseline")
    baseline.add_argument("config", type=Path)
    baseline.add_argument("--replace", action="store_true")
    checking = watch_actions.add_parser("check")
    checking.add_argument("config", type=Path)
    checking.add_argument("--fail-on-alert", action="store_true")
    checking.add_argument("--fallback-deployment", type=Path)
    _api_arguments(checking)
    return parser


def _api_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--api",
        help="send canary runs and alerts to this API (default: $MODELSTILL_API_URL when "
        "$MODELSTILL_API_TOKEN is also set)",
    )
    parser.add_argument("--no-api", action="store_true", help="keep results local")


def _ingest_parser(groups: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    ingesting = groups.add_parser("ingest", help="read traces and logs into a dataset")
    sources = ingesting.add_subparsers(dest="action", required=True)
    langfuse = sources.add_parser("langfuse", help="Langfuse generations through the public API")
    langfuse.add_argument("--from", dest="start", required=True, help="ISO 8601 start time")
    langfuse.add_argument("--to", dest="end", help="ISO 8601 end time (exclusive)")
    langfuse.add_argument("--name", help="only observations with this name")
    langfuse.add_argument("--type", dest="kind", default="GENERATION")
    langfuse.add_argument("--host", help="default $LANGFUSE_HOST or https://cloud.langfuse.com")
    langfuse.add_argument("--api", choices=("v2", "v1"), default="v2")
    langfuse.add_argument("--page-size", type=int, default=100)
    otel = sources.add_parser("otel", help="OTLP JSON export of GenAI spans")
    otel.add_argument("file", type=Path)
    litellm = sources.add_parser("litellm", help="LiteLLM spend logs (CSV, JSON or JSONL)")
    litellm.add_argument("file", type=Path)
    litellm.add_argument("--model-field", default="model", help="model or model_group")
    jsonl = sources.add_parser("jsonl", help="any JSONL file with a field mapping")
    jsonl.add_argument("file", type=Path)
    jsonl.add_argument("--input", required=True, help="dotted field, or several joined by commas")
    jsonl.add_argument("--output", help="dotted field holding the answer")
    jsonl.add_argument("--model-field", help="dotted field naming the model")
    jsonl.add_argument("--model", help="one model name for every row")
    jsonl.add_argument("--id-field")
    jsonl.add_argument("--error-field")
    bt = sources.add_parser("braintrust", help="Braintrust logs or a dataset, export or API")
    bt.add_argument("file", type=Path, nargs="?", help="JSON, JSONL or .jsonl.gz export")
    bt.add_argument("--project-id", help="fetch this project's logs through the API")
    bt.add_argument("--dataset-id", help="fetch this dataset through the API")
    bt.add_argument("--span-type", help="only spans of this type, e.g. llm (default: root spans)")
    bt.add_argument("--cases", type=Path, help="also write rows with an expected answer as cases")
    _braintrust_api_arguments(bt)
    for source in (langfuse, otel, litellm, jsonl, bt):
        source.add_argument("--out", type=Path, required=True, help="dataset JSONL to merge into")


def _import_parser(groups: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    importing = groups.add_parser(
        "import", help="record other tools' eval results as runs, then compare and gate them"
    )
    tools = importing.add_subparsers(dest="action", required=True)
    deepeval = tools.add_parser("deepeval", help="a DeepEval test run JSON")
    inspect_log = tools.add_parser("inspect", help="an Inspect log (.eval or .json)")
    inspect_log.add_argument("--scorer", help="scorer (or scorer.key) that gives the case score")
    promptfoo = tools.add_parser("promptfoo", help="a promptfoo results JSON (one run per column)")
    promptfoo.add_argument("--provider", help="only this provider id or label")
    for tool in (deepeval, inspect_log, promptfoo):
        tool.add_argument("file", type=Path)
    bt = tools.add_parser("braintrust", help="a Braintrust experiment, export or API")
    bt.add_argument("file", type=Path, nargs="?", help="JSON, JSONL or .jsonl.gz export")
    bt.add_argument("--experiment-id", help="fetch this experiment through the API")
    bt.add_argument("--scorer", help="the score that gives the case score, when there are several")
    _braintrust_api_arguments(bt)
    for tool in (deepeval, inspect_log, promptfoo, bt):
        tool.add_argument("--history", type=Path, required=True)
        tool.add_argument("--task", dest="slug", required=True, help="benchmark name for the run")
        if tool is not promptfoo:
            tool.add_argument("--model", help="model name to record (default: from the file)")
        tool.add_argument("--accept", action="store_true", help="make the run the baseline")
        tool.add_argument("--gate", type=Path, help="task spec or gate YAML to decide against")
        tool.add_argument("--flip-rate", type=float)
        tool.add_argument("--cost-ratio", type=float)
        tool.add_argument("--p95-latency-ms", type=int, help="default: measured from the file")
        tool.add_argument("--primary-metric")


def _pairwise_parser(actions: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    pairwise = actions.add_parser(
        "pairwise", help="a judge picks the better answer per case, asked in both orders"
    )
    pairwise.add_argument("history", type=Path)
    pairwise.add_argument("before")
    pairwise.add_argument("after")
    pairwise.add_argument("--spec", type=Path, help="task spec naming the judge and the teachers")
    pairwise.add_argument("--judge-model")
    pairwise.add_argument("--judge-family")
    pairwise.add_argument(
        "--teacher-family", action="append", default=[], help="repeatable; refused as the judge"
    )
    pairwise.add_argument("--instructions", default=PAIRWISE_INSTRUCTIONS)
    pairwise.add_argument("--base-url", required=True, help="OpenAI-compatible URL of the judge")
    pairwise.add_argument("--api-key-env", default="LITELLM_API_KEY")


def _braintrust_api_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--api-url", help="default $BRAINTRUST_API_URL or https://api.braintrust.dev"
    )
    parser.add_argument("--page-size", type=int, default=100)


def _push_parser(groups: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    pushing = groups.add_parser(
        "push", help="send specs, runs, gates, review items and train runs to the API"
    )
    pushing.add_argument(
        "--api", help=f"API URL (default $MODELSTILL_API_URL or {DEFAULT_API_URL})"
    )
    actions = pushing.add_subparsers(dest="action", required=True)

    task = actions.add_parser("task", help="register a task and its spec version")
    task.add_argument("spec", type=Path)
    task.add_argument(
        "--task", dest="slug", help="slug to register under (default: the spec's task)"
    )
    task.add_argument("--git-sha", help="commit the spec came from (default: git rev-parse HEAD)")

    run = actions.add_parser("run", help="push one recorded eval run")
    run.add_argument("history", type=Path)
    run.add_argument("run")
    run.add_argument("--task", dest="slug", required=True)
    run.add_argument("--primary-metric", help="named metric the dashboard shows as the score")
    run.add_argument("--split", default="gold", choices=["train", "val", "calib", "gold"])
    run.add_argument("--judge-model")
    run.add_argument(
        "--no-content",
        dest="content",
        action="store_false",
        help="send only case hashes and scores, not inputs, expected answers or outputs",
    )

    gate = actions.add_parser("gate", help="decide the release gate for a run and record it")
    gate.add_argument("history", type=Path)
    gate.add_argument("run")
    gate.add_argument("--task", dest="slug", required=True)
    gate.add_argument("--spec", type=Path, required=True)
    gate.add_argument("--previous", help="run the candidate was compared with")
    gate.add_argument("--primary-metric")
    gate.add_argument("--flip-rate", type=float, required=True)
    gate.add_argument("--cost-ratio", type=float, required=True)
    gate.add_argument("--p95-latency-ms", type=int, required=True)
    gate.add_argument(
        "--not-measured",
        action="append",
        default=[],
        metavar="CHECK[=REASON]",
        help="a check recorded at its worst-case value because it was not measured, and why",
    )

    review = actions.add_parser("review", help="upsert dataset items into the review queue")
    review.add_argument("dataset", type=Path)
    review.add_argument("--task", dest="slug", required=True)

    train = actions.add_parser("train", help="push a finished artifact and its logged metrics")
    train.add_argument("artifact", type=Path)
    train.add_argument("--task", dest="slug", required=True)
    for action in (task, run, gate, review, train):
        action.add_argument("--api", help="API URL", default=argparse.SUPPRESS)


def _report_parser(groups: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    reporting = groups.add_parser("report", help="render gate decisions for pull requests")
    actions = reporting.add_subparsers(dest="action", required=True)
    gate = actions.add_parser("gate", help="decide the gate and print it as Markdown or JSON")
    gate.add_argument("history", type=Path)
    gate.add_argument("run")
    gate.add_argument("--spec", type=Path, required=True)
    gate.add_argument("--previous", help="accepted baseline run the candidate is compared with")
    gate.add_argument("--primary-metric")
    gate.add_argument("--flip-rate", type=float, required=True)
    gate.add_argument("--cost-ratio", type=float, required=True)
    gate.add_argument("--p95-latency-ms", type=int, required=True)
    gate.add_argument("--top", type=int, default=5, help="regressed cases to list")
    gate.add_argument("--format", choices=("markdown", "json"), default="markdown")


def _report(args: argparse.Namespace) -> int:
    summary = report.gate_report(
        History(args.history),
        args.run,
        args.spec,
        previous=args.previous,
        flip_rate=args.flip_rate,
        cost_ratio=args.cost_ratio,
        p95_latency_ms=args.p95_latency_ms,
        primary_metric=args.primary_metric,
        top=args.top,
    )
    if args.format == "json":
        print(json.dumps(report.to_json(summary), indent=2))
    else:
        print(report.to_markdown(summary), end="")
    return 0 if summary.decision.passed else 2


def _langfuse_records(args: argparse.Namespace) -> Iterable[Record]:
    public = os.environ.get("LANGFUSE_PUBLIC_KEY")
    secret = os.environ.get("LANGFUSE_SECRET_KEY")
    if not public or not secret:
        raise ValueError("set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to the project's keys")
    host = (
        args.host
        or os.environ.get("LANGFUSE_HOST")
        or os.environ.get("LANGFUSE_BASE_URL")
        or DEFAULT_LANGFUSE_URL
    )
    reader = LangfuseReader(host, public, secret, api=args.api)
    rows = reader.observations(args.start, args.end, args.kind, args.name, args.page_size)
    return langfuse.records(rows)


def _braintrust_rows(
    args: argparse.Namespace, sources: dict[braintrust.Kind, str | None]
) -> list[braintrust.Row]:
    given: list[tuple[braintrust.Kind, str]] = [
        (kind, found) for kind, found in sources.items() if found
    ]
    if (args.file is not None) + len(given) != 1:
        flags = ", ".join(BRAINTRUST_FLAGS[kind] for kind in sources)
        raise ValueError(f"give one of an export file, {flags}")
    if args.file is not None:
        return braintrust.read_export(args.file)
    key = os.environ.get("BRAINTRUST_API_KEY")
    if not key:
        raise ValueError("set BRAINTRUST_API_KEY to read from the Braintrust API")
    url = args.api_url or os.environ.get("BRAINTRUST_API_URL") or braintrust.DEFAULT_API_URL
    kind, object_id = given[0]
    return list(BraintrustReader(key, url).events(kind, object_id, args.page_size))


def _braintrust_records(args: argparse.Namespace) -> Iterable[Record]:
    rows = _braintrust_rows(args, {"project_logs": args.project_id, "dataset": args.dataset_id})
    if args.cases is not None:
        written = braintrust.write_cases(braintrust.benchmark_cases(rows), args.cases)
        print(f"wrote {written} cases with an expected answer to {args.cases}")
    return braintrust.records(rows, args.span_type)


def _ingest_records(args: argparse.Namespace) -> tuple[str, Iterable[Record]]:
    if args.action == "langfuse":
        return langfuse.BUILDER, _langfuse_records(args)
    if args.action == "braintrust":
        return braintrust.BUILDER, _braintrust_records(args)
    if args.action == "otel":
        return otel.BUILDER, otel.records(otel.read_spans(args.file))
    if args.action == "litellm":
        rows = litellm_logs.read_rows(args.file)
        return litellm_logs.BUILDER, litellm_logs.records(rows, args.model_field)
    mapping = jsonl.FieldMap(
        input=args.input,
        output=args.output,
        model=args.model_field,
        model_name=args.model,
        id=args.id_field,
        error=args.error_field,
    )
    return jsonl.BUILDER, jsonl.records(jsonl.read_jsonl(args.file), mapping)


def _ingest(args: argparse.Namespace) -> None:
    builder, found = _ingest_records(args)
    read = list(found)
    items = to_items(read, source=args.action, builder=builder)
    written = write_dataset(items, args.out)
    print(
        f"read {len(read)} records from {args.action} into {len(items)} items; "
        f"{written} new or changed in {args.out}"
    )


def _imported_runs(args: argparse.Namespace) -> list[ImportedRun]:
    if args.action == "deepeval":
        return [deepeval.load(args.file, model=args.model)]
    if args.action == "inspect":
        return [inspect_logs.load(args.file, model=args.model, scorer=args.scorer)]
    if args.action == "braintrust":
        rows = _braintrust_rows(args, {"experiment": args.experiment_id})
        return [braintrust.experiment_run(rows, model=args.model, scorer=args.scorer)]
    return promptfoo.load(args.file, provider=args.provider)


def _import(args: argparse.Namespace) -> int:
    if args.gate is not None and (args.flip_rate is None or args.cost_ratio is None):
        raise ValueError(
            "--gate needs --flip-rate and --cost-ratio: the file does not measure them, and an "
            "unmeasured check is never recorded as passing"
        )
    gate = None if args.gate is None else load_gate(args.gate)
    runs = _imported_runs(args)
    if args.accept and len(runs) != 1:
        raise ValueError(f"--accept needs one run, the file holds {len(runs)}: pick --provider")
    history = History(args.history)
    passed = True
    for imported in runs:
        recorded = record_run(history, args.slug, imported)
        print(run_line(recorded))
        accepted = True
        if gate is not None:
            outcome = gate_run(
                history,
                recorded,
                gate,
                args.flip_rate,
                args.cost_ratio,
                args.p95_latency_ms,
                args.primary_metric,
            )
            print("\n".join(report_lines(recorded, outcome)))
            accepted = outcome.decision.passed
            passed = passed and accepted
        if args.accept and accepted:
            history.accept(recorded.entry.id)
            print(f"accepted {recorded.entry.id[:8]} as the baseline")
    return 0 if passed else 1


def _spec(args: argparse.Namespace) -> None:
    spec = load_spec(args.path)
    print(snapshot_hash(args.path) if args.action == "hash" else f"{spec.task} v{spec.version} ok")


def _eval(args: argparse.Namespace) -> None:
    history = History(args.history)
    if args.action == "runs":
        for entry in history.runs():
            result = entry.result
            headline = "".join(
                f"  {name} {metric.value:.3f} [{metric.low:.3f}, {metric.high:.3f}]"
                for name, metric in entry.metrics.items()
            )
            print(
                f"{entry.id[:8]}  {entry.created_at[:19]}  {entry.model:<28} "
                f"per-case {result.mean:.3f} [{result.low:.3f}, {result.high:.3f}]{headline}  "
                f"{len(result.scores)} cases  {entry.benchmark}@{entry.version[:8]}"
            )
    elif args.action == "compare":
        before, after = history.get(args.before), history.get(args.after)
        outcome = compare(before.result, after.result)
        print(
            f"{before.model} -> {after.model}: {outcome.verdict}, "
            f"difference {outcome.difference:+.3f} [{outcome.low:+.3f}, {outcome.high:+.3f}], "
            f"fixed {outcome.fixed}, broken {outcome.broken}"
        )
    elif args.action == "pairwise":
        _pairwise(args, history)
    else:
        history.accept(args.run)
        print(f"accepted {args.run}")


def _pairwise_judge(args: argparse.Namespace) -> tuple[PairwiseJudge, list[str]]:
    if args.spec is not None:
        spec = load_spec(args.spec)
        model, family = spec.eval.judge.model, spec.eval.judge.family
        teachers = [teacher.family for teacher in spec.labelling.teachers]
    else:
        model, family, teachers = args.judge_model, args.judge_family, args.teacher_family
    if not model or not family:
        raise ValueError("name the judge with --spec, or --judge-model and --judge-family")
    if not teachers:
        raise ValueError(
            "name the teachers' families with --spec or --teacher-family, so the judge can be "
            "checked against them"
        )
    client = ChatClient(args.base_url, api_key=os.environ.get(args.api_key_env, ""))
    complete = client.as_complete(temperature=0)
    return PairwiseJudge(model, family, args.instructions, complete), teachers


def _pairwise(args: argparse.Namespace, history: History) -> None:
    judge, teachers = _pairwise_judge(args)
    before, after = history.get(args.before), history.get(args.after)
    found = pairwise_compare(judge, pairwise_cases(before, after), teacher_families=teachers)
    rate = (
        "n/a"
        if found.win_rate is None
        else f"{found.win_rate:.3f} [{found.low:.3f}, {found.high:.3f}]"
    )
    print(
        f"{before.model} -> {after.model} judged by {judge.model}: {found.verdict}, "
        f"{after.model} wins {found.wins_b}, {before.model} wins {found.wins_a}, "
        f"ties {found.ties}; win rate {rate}, sign test p={found.p_value:.4f}; "
        f"inconsistent {found.inconsistent} ({found.inconsistency_rate:.3f} "
        f"[{found.inconsistency_low:.3f}, {found.inconsistency_high:.3f}])"
    )


def _client(args: argparse.Namespace) -> push.PushClient:
    token = os.environ.get("MODELSTILL_API_TOKEN")
    if not token:
        raise ValueError("set MODELSTILL_API_TOKEN to the API's write token")
    url = args.api or os.environ.get("MODELSTILL_API_URL") or DEFAULT_API_URL
    return push.PushClient(url, token=token)


def _interval(run: dict[str, object]) -> str:
    return f"{run['mean']:.3f} [{run['low']:.3f}, {run['high']:.3f}]"


def _reason(item: str) -> tuple[str, str | None]:
    name, _, reason = item.partition("=")
    return name.strip(), reason.strip() or None


def _push(args: argparse.Namespace) -> int:
    client = _client(args)
    if args.action == "task":
        spec = load_spec(args.spec)
        slug = args.slug or spec.task
        sha = args.git_sha or push.git_sha(args.spec.resolve().parent)
        reply = client.task(slug, push.task_payload(args.spec, git_sha=sha))
        task = reply["task"]
        snapshot = str(task.get("snapshotHash", ""))[:12]
        print(f"pushed task {task['slug']} v{task['version']} (snapshot {snapshot})")
    elif args.action == "run":
        entry = History(args.history).get(args.run)
        payload = push.run_payload(
            entry, args.primary_metric, args.split, args.judge_model, content=args.content
        )
        if args.primary_metric and payload["primaryMetric"] is None:
            print(
                f"run {entry.id[:8]} has no {args.primary_metric}; the dashboard shows its "
                "per-case mean",
                file=sys.stderr,
            )
        run = client.run(args.slug, payload)["run"]
        label = run.get("primaryMetric") or "per-case mean"
        cases = run["cases"]
        print(f"pushed run {entry.id[:8]} to {args.slug}: {label} {_interval(run)}, {cases} cases")
    elif args.action == "gate":
        history = History(args.history)
        entry = history.get(args.run)
        previous = history.get(args.previous) if args.previous else None
        settings = load_spec(args.spec).eval.gate
        if settings.max_regression is not None and previous is None:
            raise ValueError("this gate compares with the baseline: pass --previous <accepted run>")
        measured = push.measurements(
            entry,
            args.primary_metric,
            args.flip_rate,
            args.cost_ratio,
            args.p95_latency_ms,
            previous=previous,
        )
        decision = decide(settings, measured)
        given = dict(_reason(item) for item in args.not_measured)
        payload = push.gate_payload(
            entry,
            previous,
            decision,
            measured,
            args.primary_metric,
            settings.model_dump(),
            push.not_measured(decision, given),
        )
        client.gate(args.slug, payload)
        verdict = "passed" if decision.passed else "failed"
        print(f"pushed gate {payload['id'][:8]} for run {entry.id[:8]} to {args.slug}: {verdict}")
        return 0 if decision.passed else 2
    elif args.action == "train":
        key, payload = push.train_run_payload(args.artifact)
        points = push.log_history_points(args.artifact)
        client.train_run(args.slug, key, payload)
        client.train_metrics(key, points)
        print(f"pushed train run {key} to {args.slug}: {len(points)} metric points")
    else:
        items = push.review_items(args.dataset)
        upserted = client.review(args.slug, items)
        queued = sum(item["reviewState"] == "queued" for item in items)
        print(f"pushed {upserted} of {len(items)} review items to {args.slug} ({queued} queued)")
    return 0


def _train(args: argparse.Namespace) -> None:
    if args.action == "run":
        settings = {
            name: value
            for name in (
                "max_steps",
                "max_seq_length",
                "learning_rate",
                "epochs",
                "batch_size",
                "gradient_accumulation",
                "eval_steps",
                "gradient_checkpointing",
                "method",
                "modality",
                "quantization",
            )
            if (value := getattr(args, name)) is not None
        }
        options = {
            name: value
            for name in ("gpu", "timeout_minutes")
            if (value := getattr(args, name)) is not None
        }
        if (args.dry_run or options) and args.backend != "modal":
            raise ValueError("--dry-run, --gpu and --timeout-minutes need --backend modal")
        if args.teacher is not None:
            distill: dict[str, object] = {"teacher": args.teacher}
            if args.beta is not None:
                distill["beta"] = args.beta
            if args.max_completion_length is not None:
                distill["max_completion_length"] = args.max_completion_length
            settings["distill"] = distill
        if args.method == "grpo":
            rl: dict[str, object] = {
                name: value
                for name, value in (
                    ("reward", args.reward),
                    ("loss", args.loss),
                    ("num_generations", args.num_generations),
                    ("importance_sampling_level", args.importance_level),
                    ("max_completion_length", args.max_completion_length),
                )
                if value is not None
            }
            settings["rl"] = rl
        remote = {
            name: value
            for name in ("host", "gpus", "stop_services")
            if (value := getattr(args, name)) is not None
        }
        if remote and args.backend != "remote":
            raise ValueError("--host, --gpus and --stop-service need --backend remote")
        if args.backend == "remote" and "host" not in remote:
            raise ValueError("--backend remote needs --host")
        options.update(remote)
        plans = plans_from_spec(
            args.spec,
            train=args.train,
            val=args.val,
            output_root=args.output_root,
            base=args.base,
            seeds=None if args.seed is None else [args.seed],
            **settings,
        )
        if args.dry_run:
            for plan in plans:
                print(json.dumps(modal_plan.dry_run(plan, **options)))
            return
        trainer = load_backend(args.backend, **options)
        for plan in plans:
            artifact = trainer.train(plan)
            print(
                json.dumps(
                    {
                        "path": str(artifact.path),
                        "served_name": served_name(artifact.path),
                        "dtype": artifact.dtype,
                        "metrics": artifact.metrics,
                    }
                )
            )
    else:
        text = Path(args.prompt).read_text() if Path(args.prompt).is_file() else args.prompt
        request = json.loads(text)
        messages = request["messages"] if isinstance(request, dict) else request
        model = load_local_model(args.artifact, max_new_tokens=args.max_new_tokens)
        print(json.dumps(model.generate(messages).model_dump()))


def _read_pairs(path: Path) -> tuple[list[float], list[bool]]:
    confidences: list[float] = []
    correct: list[bool] = []
    for number, line in enumerate(jsonl_lines(path.read_text()), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row.get("confidence"), int | float) or not isinstance(
            row.get("correct"), bool
        ):
            raise ValueError(f"line {number}: needs a numeric confidence and a boolean correct")
        confidences.append(float(row["confidence"]))
        correct.append(row["correct"])
    return confidences, correct


def _serve(args: argparse.Namespace) -> None:
    if args.action == "up":
        key = args.key_file.read_text().strip()
        served = HostServer(args.host).up(
            args.artifacts, args.gpu, args.port, key, stop_services=args.stop_services
        )
        tunnel = f"ssh -N -L {args.port}:127.0.0.1:{args.port} {args.host}"
        print(json.dumps({"served": served, "port": args.port, "tunnel": tunnel}))
        return
    if args.action == "down":
        HostServer(args.host).down(args.port)
        return
    confidences, correct = _read_pairs(args.pairs)
    result = deferral_threshold(confidences, correct, args.target_error, args.delta)
    write_threshold(args.deployment, result.threshold)
    if result.threshold is None:
        print(
            f"no threshold keeps error under {args.target_error} on {len(confidences)} items; "
            f"cleared it in {args.deployment}, so serve mode defers every request"
        )
        return
    print(
        f"threshold {result.threshold:.6f}  coverage {result.coverage:.3f}  "
        f"accepted error upper bound {result.accepted_error_upper:.4f} "
        f"(target {args.target_error}, delta {args.delta}, {len(confidences)} items) "
        f"-> {args.deployment}"
    )


def _alert_sinks(config: MonitorConfig) -> list[AlertSink]:
    sinks: list[AlertSink] = []
    if config.alerts.log:
        sinks.append(LogAlertSink())
    if config.alerts.discord_env:
        sinks.append(DiscordAlertSink(env=config.alerts.discord_env))
    return sinks


def _stores(config: MonitorConfig) -> list[TableStore]:
    stores: list[TableStore] = [JsonlStore(config.state_dir)]
    if config.clickhouse is not None:
        clickhouse = config.clickhouse
        password = os.environ.get(clickhouse.password_env) if clickhouse.password_env else None
        stores.append(ClickHouseStore(clickhouse.url, user=clickhouse.user, password=password))
    return stores


def _now() -> datetime:
    return datetime.now(UTC)


def _api_sink(args: argparse.Namespace, config: MonitorConfig) -> ApiMonitorSink | None:
    return api_sink_from(config.task, config.state_dir, url=args.api, disabled=args.no_api)


def _flush(sink: ApiMonitorSink | None) -> None:
    if sink is None:
        return
    result = sink.flush()
    if result.error is None:
        print(f"sent {result.sent} records to the API", file=sys.stderr)
    else:
        print(
            f"sent {result.sent} records to the API, kept {result.kept} to resend next run: "
            f"{result.error}",
            file=sys.stderr,
        )


def _monitor(args: argparse.Namespace) -> int:
    config = load_monitor_config(args.config)
    alerts = _alert_sinks(config)
    sink = _api_sink(args, config)
    stores = _stores(config)
    if sink is not None:
        alerts.append(sink)
        stores.append(sink)
    target = config.target
    chat = ChatClient(target.base_url, api_key=target.api_key(), timeout=target.timeout)
    try:
        if args.action == "canary":
            outcome = run_canary(config, chat, stores=stores, alerts=alerts, clock=_now)
            print(json.dumps(outcome.summary, default=str))
            fired = outcome.alerts
        else:
            drift = run_drift(config, chat, alerts=alerts, clock=_now)
            report = asdict(drift)
            report["answered"] = len(report.pop("items"))
            report["alerts"] = [alert.kind for alert in drift.alerts]
            print(json.dumps(report, default=str))
            fired = drift.alerts
    finally:
        _flush(sink)
    return 2 if fired and args.fail_on_alert else 0


def _watch(args: argparse.Namespace) -> int:
    config = load_monitor_config(args.config)
    alerts = _alert_sinks(config)
    target = config.target
    chat = ChatClient(target.base_url, api_key=target.api_key(), timeout=target.timeout)
    if args.action == "baseline":
        recorded = record_baseline(config, chat, clock=_now, replace=args.replace)
        print(json.dumps(recorded.summary, default=str))
        return 0
    sink = _api_sink(args, config)
    stores = _stores(config)
    if sink is not None:
        alerts.append(sink)
        stores.append(sink)
    try:
        outcome = check_watch(
            config, chat, stores, alerts, clock=_now, fallback=args.fallback_deployment
        )
        if outcome.fallback and sink is not None:
            print(sink.rollback(), file=sys.stderr)
    finally:
        _flush(sink)
    print(json.dumps(outcome.summary, default=str))
    return 2 if args.fail_on_alert and outcome.level in ("warn", "critical") else 0


def _sample(args: argparse.Namespace) -> None:
    client = ChatClient(args.base_url, api_key=args.key_file.read_text().strip())
    prompts = [json.loads(line) for line in jsonl_lines(args.prompts.read_text()) if line.strip()]
    count = sample(
        client, args.model, prompts, args.out, args.top_logprobs, args.temperature, args.max_tokens
    )
    print(json.dumps({"model": args.model, "rows": count, "out": str(args.out)}))


def _export(args: argparse.Namespace) -> None:
    if args.to == "peft":
        out = export_peft(args.artifact, args.out)
    elif args.host is None:
        raise ValueError(f"--to {args.to} loads the model, so it runs on a GPU host: pass --host")
    else:
        exporter = RemoteExporter(args.host, gpu=args.gpu, llama_cpp=args.llama_cpp)
        out = exporter.export(args.artifact, args.to, args.out, outtype=args.outtype)
    print(json.dumps({"artifact": str(args.artifact), "format": args.to, "out": str(out)}))


def _attest(args: argparse.Namespace) -> int:
    named = {name: path for name in ("train", "val") if (path := getattr(args, name)) is not None}
    if not named:
        raise ValueError("name at least one file: --train and/or --val")
    problems = verify(load_attestation(args.artifact), named)
    print(json.dumps({"artifact": str(args.artifact), "ok": not problems, "problems": problems}))
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.group == "spec":
            _spec(args)
        elif args.group == "push":
            return _push(args)
        elif args.group == "report":
            return _report(args)
        elif args.group == "setup":
            return run_setup(args.agent)
        elif args.group == "quickstart":
            print(write_quickstart(args.directory), end="")
        elif args.group == "train":
            _train(args)
        elif args.group == "eval":
            _eval(args)
        elif args.group == "serve":
            _serve(args)
        elif args.group == "attest":
            return _attest(args)
        elif args.group == "export":
            _export(args)
        elif args.group == "sample":
            _sample(args)
        elif args.group == "swap":
            return swap.main(args)
        elif args.group == "watch":
            return _watch(args)
        elif args.group == "ingest":
            _ingest(args)
        elif args.group == "import":
            return _import(args)
        else:
            return _monitor(args)
    except (
        ValidationError,
        FileNotFoundError,
        FileExistsError,
        KeyError,
        ValueError,
        RuntimeError,
        SinkError,
        push.PushError,
        LangfuseError,
        BraintrustError,
        ChatError,
        JudgeError,
    ) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
