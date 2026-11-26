import hashlib
import importlib
import json
import logging
import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from modelstill.benchmark import load_benchmark, result_from_json, result_to_json
from modelstill.client import ChatError
from modelstill.evals import Case, Comparison, RunResult, compare, exact_match, run
from modelstill.jsonl import jsonl_lines
from modelstill.monitor.alerts import Alert, AlertSink
from modelstill.serve.backends import Chat
from modelstill.serve.config import Endpoint
from modelstill.serve.events import clickhouse_time
from modelstill.sinks import Row, TableStore

_log = logging.getLogger(__name__)

CANARY_RESULTS = "modelstill.canary_results"
CANARY_RUNS = "modelstill.canary_runs"


class Plugin(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str
    args: dict[str, Any] = Field(default_factory=dict)


class CanarySettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    benchmark: Path
    limit: int | None = Field(default=None, gt=0)
    metric: Plugin = Plugin(ref="exact_match")
    pass_at: float = Field(default=1.0, gt=0, le=1)
    floor: float = Field(ge=0, le=1)


class DriftSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    prompts: Path
    limit: int | None = Field(default=None, gt=0)


class WatchSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    prompts: Path
    limit: int | None = Field(default=None, gt=0)
    repeats: int = Field(default=2, ge=2, le=10)
    logprobs: bool = True
    top_logprobs: int = Field(default=5, ge=0, le=20)
    max_tokens: int = Field(default=16, gt=0)
    alpha: float = Field(default=0.01, gt=0, lt=1)
    critical_shift: float = Field(default=0.25, gt=0)
    max_changed: float = Field(default=0.1, ge=0, le=1)
    rounds: int = Field(default=10_000, gt=0)


class ClickHouseConnection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str
    user: str | None = None
    password_env: str | None = None


class AlertSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    log: bool = True
    discord_env: str | None = None


class MonitorConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task: str
    target: Endpoint
    provider: str | None = None
    request: Plugin = Plugin(ref="messages")
    params: dict[str, Any] = Field(default_factory=lambda: {"temperature": 0})
    state_dir: Path
    clickhouse: ClickHouseConnection | None = None
    alerts: AlertSettings = AlertSettings()
    canary: CanarySettings | None = None
    drift: DriftSettings | None = None
    watch: WatchSettings | None = None

    @property
    def model(self) -> str:
        if not self.target.model:
            raise ValueError("target.model is required for monitoring")
        return self.target.model

    @property
    def provider_label(self) -> str:
        return self.provider or self.model


def _relative(base: Path, path: Path) -> Path:
    path = path.expanduser()
    return path if path.is_absolute() else base / path


def load_monitor_config(path: Path) -> MonitorConfig:
    config = MonitorConfig.model_validate(yaml.safe_load(path.read_text()))
    base = path.parent
    target = config.target
    if target.api_key_file is not None:
        target = target.model_copy(update={"api_key_file": _relative(base, target.api_key_file)})
    update: dict[str, Any] = {"state_dir": _relative(base, config.state_dir), "target": target}
    if config.canary is not None:
        update["canary"] = config.canary.model_copy(
            update={"benchmark": _relative(base, config.canary.benchmark)}
        )
    if config.drift is not None:
        update["drift"] = config.drift.model_copy(
            update={"prompts": _relative(base, config.drift.prompts)}
        )
    if config.watch is not None:
        update["watch"] = config.watch.model_copy(
            update={"prompts": _relative(base, config.watch.prompts)}
        )
    return config.model_copy(update=update)


def _messages(value: Any) -> list[dict[str, str]]:
    if isinstance(value, dict) and isinstance(value.get("messages"), list):
        return value["messages"]
    if isinstance(value, str):
        return [{"role": "user", "content": value}]
    raise ValueError("the built-in request needs an input holding messages or a string")


def _json_equal(output: str, expected: Any) -> float:
    try:
        return 1.0 if json.loads(output) == expected else 0.0
    except ValueError:
        return 0.0


def _exact_text(output: Any, expected: Any) -> float:
    return exact_match(output.strip() if isinstance(output, str) else output, expected)


_BUILTINS: dict[str, dict[str, Any]] = {
    "metric": {"exact_match": _exact_text, "json_equal": _json_equal},
    "request": {"messages": _messages},
}


def resolve(plugin: Plugin | dict[str, Any], kind: Literal["metric", "request"]) -> Any:
    spec = plugin if isinstance(plugin, Plugin) else Plugin.model_validate(plugin)
    if spec.ref in _BUILTINS[kind]:
        target = _BUILTINS[kind][spec.ref]
    else:
        module, _, attribute = spec.ref.partition(":")
        if not attribute:
            raise ValueError(f"unknown {kind} {spec.ref!r}: use a built-in or module:attribute")
        target = getattr(importlib.import_module(module), attribute)
    return target(**spec.args) if spec.args else target


def stable_hash(value: Any) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in jsonl_lines(path.read_text()) if line.strip()]


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(json.dumps(row, default=str) + "\n")


def load_cases(path: Path, limit: int | None) -> tuple[str, tuple[Case, ...]]:
    benchmark = load_benchmark(path)
    cases = benchmark.cases[:limit] if limit else benchmark.cases
    return benchmark.version, cases


def check_canary(
    task: str,
    provider: str,
    result: RunResult,
    previous: RunResult | None,
    floor: float,
) -> tuple[list[Alert], Comparison | None]:
    alerts: list[Alert] = []
    total = len(result.scores)
    summary = f"pass rate {result.mean:.2f} [{result.low:.2f}, {result.high:.2f}] on {total} items"
    if result.high < floor:
        alerts.append(
            Alert(
                "canary_below_floor",
                task,
                f"{provider}: {summary} is below the floor {floor:.2f}",
                {"provider": provider, "low": result.low, "high": result.high, "floor": floor},
            )
        )
    comparison = None
    same_items = previous is not None and [s.case_id for s in previous.scores] == [
        s.case_id for s in result.scores
    ]
    if previous is not None and same_items:
        comparison = compare(previous, result)
        if comparison.verdict == "worse":
            alerts.append(
                Alert(
                    "canary_regression",
                    task,
                    f"{provider}: {summary}, down {-comparison.difference:.2f} "
                    f"[{-comparison.high:.2f}, {-comparison.low:.2f}] from the last run; "
                    f"{comparison.broken} items broke, {comparison.fixed} fixed",
                    {"provider": provider, "broken": comparison.broken, "fixed": comparison.fixed},
                )
            )
    return alerts, comparison


@dataclass(frozen=True)
class CanaryOutcome:
    run_id: str
    ts: datetime
    result: RunResult
    passed: int
    total: int
    low: float
    high: float
    comparison: Comparison | None
    alerts: tuple[Alert, ...]
    summary: Row


def send_alerts(alerts: Sequence[Alert], sinks: Sequence[AlertSink]) -> None:
    for alert in alerts:
        for sink in sinks:
            try:
                sink.send(alert)
            except Exception as error:  # noqa: BLE001
                _log.error("alert sink %s failed: %s", type(sink).__name__, error)


def score_canary(
    config: MonitorConfig, settings: CanarySettings, chat: Chat
) -> tuple[str, tuple[Case, ...], RunResult]:
    version, cases = load_cases(settings.benchmark, settings.limit)
    build = resolve(config.request, "request")
    metric = resolve(settings.metric, "metric")

    def ask(value: Any) -> str:
        return chat.chat(config.model, build(value), **config.params).text

    def passes(output: Any, expected: Any) -> float:
        return 1.0 if metric(output, expected) >= settings.pass_at else 0.0

    return version, cases, run(cases, ask, passes)


def run_canary(
    config: MonitorConfig,
    chat: Chat,
    stores: Sequence[TableStore],
    alerts: Sequence[AlertSink],
    clock: Callable[[], datetime],
) -> CanaryOutcome:
    if config.canary is None:
        raise ValueError("the config has no canary section")
    settings = config.canary
    provider = config.provider_label
    version, cases, result = score_canary(config, settings, chat)
    history_path = config.state_dir / "canary-history.jsonl"
    previous_row = next(
        (
            row
            for row in reversed(read_jsonl(history_path))
            if row["task"] == config.task
            and row["provider"] == provider
            and row["version"] == version
        ),
        None,
    )
    previous = result_from_json(previous_row["result"]) if previous_row else None
    fired, comparison = check_canary(config.task, provider, result, previous, settings.floor)
    send_alerts(fired, alerts)

    run_id, ts = uuid.uuid4().hex, clock()
    append_jsonl(
        history_path,
        {
            "run_id": run_id,
            "ts": ts.isoformat(),
            "task": config.task,
            "provider": provider,
            "version": version,
            "result": result_to_json(result),
        },
    )
    stamp = clickhouse_time(ts)
    expected = {case.id: case for case in cases}
    items = [
        {
            "ts": stamp,
            "task": config.task,
            "provider": provider,
            "item_hash": stable_hash([score.case_id, expected[score.case_id].input]),
            "expected_hash": stable_hash(expected[score.case_id].expected),
            "got_hash": stable_hash(
                score.output if score.error is None else f"error: {score.error}"
            ),
            "pass": score.score == 1.0,
        }
        for score in result.scores
    ]
    passed = sum(1 for item in items if item["pass"])
    summary: Row = {
        "ts": stamp,
        "run_id": run_id,
        "task": config.task,
        "provider": provider,
        "benchmark_version": version[:16],
        "items": len(items),
        "passed": passed,
        "pass_rate": result.mean,
        "low": result.low,
        "high": result.high,
        "floor": settings.floor,
        "previous_run_id": previous_row["run_id"] if previous_row else None,
        "difference": comparison.difference if comparison else None,
        "difference_low": comparison.low if comparison else None,
        "difference_high": comparison.high if comparison else None,
        "alerts": [alert.kind for alert in fired],
    }
    for store in stores:
        store.write(CANARY_RESULTS, items)
        store.write(CANARY_RUNS, [summary])
    return CanaryOutcome(
        run_id=run_id,
        ts=ts,
        result=result,
        passed=passed,
        total=len(items),
        low=result.low,
        high=result.high,
        comparison=comparison,
        alerts=tuple(fired),
        summary=summary,
    )


@dataclass(frozen=True)
class DriftResult:
    run_id: str
    fingerprint: str
    items: dict[str, str]
    failed: list[str]
    changed: list[str]
    previous: str | None
    models: dict[str, int] = field(default_factory=dict)
    alerts: tuple[Alert, ...] = ()


def run_drift(
    config: MonitorConfig,
    chat: Chat,
    alerts: Sequence[AlertSink],
    clock: Callable[[], datetime],
) -> DriftResult:
    if config.drift is None:
        raise ValueError("the config has no drift section")
    _, cases = load_cases(config.drift.prompts, config.drift.limit)
    build = resolve(config.request, "request")
    params = {**config.params, "temperature": 0}
    provider = config.provider_label
    items: dict[str, str] = {}
    failed: list[str] = []
    models: Counter[str] = Counter()
    for case in cases:
        try:
            reply = chat.chat(config.model, build(case.input), **params)
        except (ChatError, OSError) as error:
            _log.warning("drift item %s failed: %s", case.id, error)
            failed.append(case.id)
            continue
        items[case.id] = hashlib.sha256(reply.text.encode()).hexdigest()
        models[reply.model] += 1
    fingerprint = stable_hash(sorted(items.items()))
    history_path = config.state_dir / "drift-history.jsonl"
    previous = next(
        (
            row
            for row in reversed(read_jsonl(history_path))
            if row["task"] == config.task and row["provider"] == provider
        ),
        None,
    )
    changed = (
        sorted(key for key, value in items.items() if previous["items"].get(key, value) != value)
        if previous
        else []
    )
    fired: list[Alert] = []
    if changed:
        fired.append(
            Alert(
                "provider_drift",
                config.task,
                f"{provider}: {len(changed)} of {len(items)} fixed prompts got a different answer "
                "at temperature 0 since the last check; the model behind the alias may have "
                "changed",
                {"provider": provider, "changed": changed[:20], "models": dict(models)},
            )
        )
    send_alerts(fired, alerts)
    run_id = uuid.uuid4().hex
    append_jsonl(
        history_path,
        {
            "run_id": run_id,
            "ts": clock().isoformat(),
            "task": config.task,
            "provider": provider,
            "fingerprint": fingerprint,
            "items": items,
            "failed": failed,
            "models": dict(models),
        },
    )
    return DriftResult(
        run_id=run_id,
        fingerprint=fingerprint,
        items=items,
        failed=failed,
        changed=changed,
        previous=previous["fingerprint"] if previous else None,
        models=dict(models),
        alerts=tuple(fired),
    )
