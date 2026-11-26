import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from modelstill.benchmark import Benchmark, History, HistoryEntry, MetricValue
from modelstill.data import input_hash
from modelstill.evals import Case, Comparison, ScoredCase, compare, mean_interval, summarise
from modelstill.gate import Decision, Measurements, decide
from modelstill.push import measurements
from modelstill.spec import Gate, load_spec


@dataclass(frozen=True)
class ImportedCase:
    id: str
    input: Any
    expected: Any
    score: float
    output: Any = None
    error: str | None = None
    metrics: Mapping[str, float] = field(default_factory=dict)
    latency_ms: float | None = None


@dataclass(frozen=True)
class ImportedRun:
    model: str
    source: str
    cases: tuple[ImportedCase, ...]


@dataclass(frozen=True)
class RecordedRun:
    entry: HistoryEntry
    benchmark: Benchmark
    p95_latency_ms: int | None


@dataclass(frozen=True)
class GateOutcome:
    decision: Decision
    measured: Measurements
    baseline: HistoryEntry | None
    comparison: Comparison | None


def case_ids(names: Sequence[str], contents: Sequence[Any]) -> list[str]:
    if len(set(names)) == len(names):
        return list(names)
    return [
        f"{name}:{input_hash(content)[:12]}" for name, content in zip(names, contents, strict=True)
    ]


def p95(values: Sequence[float]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return math.ceil(ordered[math.ceil(0.95 * len(ordered)) - 1])


def _sorted_cases(run: ImportedRun) -> list[ImportedCase]:
    seen: set[str] = set()
    for case in run.cases:
        if case.id in seen:
            raise ValueError(f"case id {case.id!r} appears more than once in the {run.source} run")
        seen.add(case.id)
    return sorted(run.cases, key=lambda case: case.id)


def _metric(values: Sequence[float]) -> MetricValue:
    estimate = mean_interval(values)
    return MetricValue(estimate.value, estimate.low, estimate.high)


def _metrics(cases: Sequence[ImportedCase]) -> dict[str, MetricValue]:
    names = dict.fromkeys(name for case in cases for name in case.metrics)
    return {
        name: _metric([case.metrics[name] for case in cases if name in case.metrics])
        for name in names
    }


def record_run(history: History, task: str, run: ImportedRun) -> RecordedRun:
    cases = _sorted_cases(run)
    benchmark = Benchmark(task, tuple(Case(c.id, c.input, c.expected) for c in cases))
    result = summarise([ScoredCase(c.id, c.output, c.score, c.error) for c in cases])
    per_case = {c.id: dict(c.metrics) for c in cases if c.metrics}
    run_id = history.record(benchmark, run.model, result, _metrics(cases), per_case)
    latencies = [c.latency_ms for c in cases if c.latency_ms is not None]
    return RecordedRun(history.get(run_id), benchmark, p95(latencies))


def load_gate(path: Path) -> Gate:
    data = yaml.safe_load(path.read_text())
    if isinstance(data, dict) and "task" in data:
        return load_spec(path).eval.gate
    if isinstance(data, dict) and "gate" in data:
        return Gate.model_validate(data["gate"])
    return Gate.model_validate(data)


def gate_run(
    history: History,
    recorded: RecordedRun,
    gate: Gate,
    flip_rate: float,
    cost_ratio: float,
    p95_latency_ms: int | None = None,
    primary_metric: str | None = None,
) -> GateOutcome:
    entry = recorded.entry
    baseline = history.last_accepted(recorded.benchmark)
    if gate.max_regression is not None and baseline is None:
        raise ValueError(
            f"no accepted baseline for {entry.benchmark}@{entry.version[:8]}: record a run and "
            "make it the baseline with `modelstill eval accept <history> <run>`"
        )
    latency = p95_latency_ms if p95_latency_ms is not None else recorded.p95_latency_ms
    if latency is None:
        raise ValueError("the run has no latencies: pass the measured p95 latency in ms")
    measured = measurements(entry, primary_metric, flip_rate, cost_ratio, latency, baseline)
    decision = decide(gate, measured)
    report = {
        **decision.to_report(),
        "measurements": measured.model_dump(),
        "gate": gate.model_dump(),
        "primaryMetric": primary_metric if primary_metric in entry.metrics else None,
    }
    history.record_gate(entry.id, baseline.id if baseline else None, report)
    comparison = None if baseline is None else compare(baseline.result, entry.result)
    return GateOutcome(decision, measured, baseline, comparison)


def run_line(recorded: RecordedRun) -> str:
    entry = recorded.entry
    result = entry.result
    return (
        f"recorded {entry.id[:8]} {entry.model}: {result.mean:.3f} "
        f"[{result.low:.3f}, {result.high:.3f}] over {len(result.scores)} cases "
        f"({entry.benchmark}@{entry.version[:8]})"
    )


def report_lines(recorded: RecordedRun, outcome: GateOutcome) -> list[str]:
    lines: list[str] = []
    if outcome.baseline is not None and outcome.comparison is not None:
        found = outcome.comparison
        lines.append(
            f"vs baseline {outcome.baseline.id[:8]} {outcome.baseline.model}: {found.verdict}, "
            f"difference {found.difference:+.3f} [{found.low:+.3f}, {found.high:+.3f}], "
            f"fixed {found.fixed}, broken {found.broken}"
        )
    for check in outcome.decision.checks:
        mark = "ok" if check.passed else "FAILED"
        lines.append(f"  {check.name}: {check.value:g} (limit {check.threshold:g}) {mark}")
    verdict = "passed" if outcome.decision.passed else "FAILED"
    lines.append(f"gate {verdict} for run {recorded.entry.id[:8]}")
    return lines
