from dataclasses import dataclass
from pathlib import Path
from typing import Any

from modelstill.benchmark import History, HistoryEntry
from modelstill.evals import Comparison, compare
from modelstill.gate import Check, Decision, Measurements, decide
from modelstill.spec import load_spec

MARKER = "<!-- modelstill-gate -->"
AT_LEAST = frozenset({"metric_lower_bound", "regression_vs_baseline"})


@dataclass(frozen=True)
class Regression:
    case_id: str
    before: float
    after: float


@dataclass(frozen=True)
class GateSummary:
    entry: HistoryEntry
    previous: HistoryEntry | None
    decision: Decision
    measured: Measurements
    metric_name: str
    metric_high: float
    comparison: Comparison | None
    regressions: tuple[Regression, ...]

    @property
    def metric_low(self) -> float:
        return self.measured.metric_low


def _regressions(before: HistoryEntry, after: HistoryEntry, top: int) -> tuple[Regression, ...]:
    pairs = zip(before.result.scores, after.result.scores, strict=True)
    worse = [
        Regression(old.case_id, old.score, new.score) for old, new in pairs if new.score < old.score
    ]
    worse.sort(key=lambda item: (item.after - item.before, item.case_id))
    return tuple(worse[:top])


def gate_report(
    history: History,
    run_id: str,
    spec_path: Path,
    previous: str | None,
    flip_rate: float,
    cost_ratio: float,
    p95_latency_ms: int,
    primary_metric: str | None = None,
    top: int = 5,
) -> GateSummary:
    entry = history.get(run_id)
    baseline = history.get(previous) if previous else None
    settings = load_spec(spec_path).eval.gate
    if settings.max_regression is not None and baseline is None:
        raise ValueError("this gate compares with the baseline: pass --previous <accepted run>")
    comparison = None if baseline is None else compare(baseline.result, entry.result)
    metric = entry.metrics.get(primary_metric) if primary_metric else None
    measured = Measurements(
        metric_mean=metric.value if metric else entry.result.mean,
        metric_low=metric.low if metric else entry.result.low,
        metric_cases=len(entry.result.scores),
        flip_rate=flip_rate,
        cost_ratio=cost_ratio,
        p95_latency_ms=p95_latency_ms,
        baseline_difference_low=None if comparison is None else comparison.low,
    )
    return GateSummary(
        entry=entry,
        previous=baseline,
        decision=decide(settings, measured),
        measured=measured,
        metric_name=primary_metric if metric and primary_metric else "per-case mean",
        metric_high=metric.high if metric else entry.result.high,
        comparison=comparison,
        regressions=() if baseline is None else _regressions(baseline, entry, top),
    )


def _interval(summary: GateSummary, check: Check) -> tuple[float, float] | None:
    if check.name == "metric_lower_bound":
        return summary.metric_low, summary.metric_high
    if check.name == "regression_vs_baseline" and summary.comparison is not None:
        return summary.comparison.low, summary.comparison.high
    return None


def _direction(check: Check) -> str:
    return ">=" if check.name in AT_LEAST else "<="


def _run(entry: HistoryEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "model": entry.model,
        "benchmark": entry.benchmark,
        "version": entry.version,
    }


def to_json(summary: GateSummary) -> dict[str, Any]:
    comparison = summary.comparison
    return {
        "passed": summary.decision.passed,
        "run": _run(summary.entry),
        "previous": None if summary.previous is None else _run(summary.previous),
        "metric": {
            "name": summary.metric_name,
            "value": summary.measured.metric_mean,
            "low": summary.metric_low,
            "high": summary.metric_high,
            "cases": summary.measured.metric_cases,
        },
        "checks": [
            {
                "name": check.name,
                "direction": _direction(check),
                "threshold": check.threshold,
                "value": check.value,
                "interval": None if (bounds := _interval(summary, check)) is None else [*bounds],
                "passed": check.passed,
            }
            for check in summary.decision.checks
        ],
        "comparison": None
        if comparison is None
        else {
            "difference": comparison.difference,
            "low": comparison.low,
            "high": comparison.high,
            "verdict": comparison.verdict,
            "fixed": comparison.fixed,
            "broken": comparison.broken,
        },
        "regressions": [
            {"case_id": item.case_id, "before": item.before, "after": item.after}
            for item in summary.regressions
        ],
    }


def _number(name: str, value: float) -> str:
    return f"{value:.0f}" if name == "p95_latency_ms" else f"{value:.3f}"


def _check_row(summary: GateSummary, check: Check) -> str:
    bounds = _interval(summary, check)
    interval = "not sampled" if bounds is None else f"[{bounds[0]:+.3f}, {bounds[1]:+.3f}]"
    threshold = f"{_direction(check)} {_number(check.name, check.threshold)}"
    measured = _number(check.name, check.value)
    result = "pass" if check.passed else "**fail**"
    return f"| {check.name} | {threshold} | {measured} | {interval} | {result} |"


def _label(entry: HistoryEntry) -> str:
    return f"`{entry.id[:8]}` ({entry.model})"


def _comparison_lines(summary: GateSummary) -> list[str]:
    comparison = summary.comparison
    if comparison is None:
        return []
    lines = [
        "",
        "#### Paired comparison",
        "",
        f"Difference {comparison.difference:+.3f} [{comparison.low:+.3f}, {comparison.high:+.3f}]"
        f" ({comparison.verdict.replace('_', ' ')}) over {summary.measured.metric_cases} cases: "
        f"{comparison.fixed} fixed, {comparison.broken} broken.",
    ]
    if summary.regressions:
        lines += ["", "| Case | Before | After |", "|---|---|---|"]
        lines += [
            f"| {item.case_id} | {item.before:.3f} | {item.after:.3f} |"
            for item in summary.regressions
        ]
    return lines


def to_markdown(summary: GateSummary) -> str:
    entry, measured = summary.entry, summary.measured
    verdict = "passed" if summary.decision.passed else "failed"
    against = "" if summary.previous is None else f", compared with {_label(summary.previous)}"
    lines = [
        MARKER,
        f"### ModelStill gate: {verdict}",
        "",
        f"Run {_label(entry)} on `{entry.benchmark}@{entry.version[:8]}`{against}.",
        f"{summary.metric_name} {measured.metric_mean:.3f} "
        f"[{summary.metric_low:.3f}, {summary.metric_high:.3f}], {measured.metric_cases} cases.",
        "",
        "| Check | Threshold | Measured | Interval | Result |",
        "|---|---|---|---|---|",
        *(_check_row(summary, check) for check in summary.decision.checks),
        *_comparison_lines(summary),
    ]
    return "\n".join(lines) + "\n"
