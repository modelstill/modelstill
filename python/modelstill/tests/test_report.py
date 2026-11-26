import json
from collections.abc import Callable
from pathlib import Path

import pytest

from modelstill.benchmark import Benchmark, History
from modelstill.cli import main
from modelstill.evals import Case, exact_match, micro_f1, run, set_f1
from modelstill.report import MARKER, gate_report, to_json, to_markdown

TASK_SPEC = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"

CASES = tuple(Case(f"case-{i:03d}", i, ["a"] if i % 2 else []) for i in range(200))
BENCH = Benchmark(name="tech_gold", cases=CASES)


def history_with(
    path: Path, before: Callable[[int], list[str]], after: Callable[[int], list[str]]
) -> tuple[str, str]:
    history = History(path)
    first = run(CASES, model=before, metric=set_f1)
    second = run(CASES, model=after, metric=set_f1)
    return (
        history.record(BENCH, "cloud", first),
        history.record(BENCH, "student", second, metrics={"pooled_f1": micro_f1(CASES, second)}),
    )


def perfect(i: int) -> list[str]:
    return ["a"] if i % 2 else []


def breaks_some(i: int) -> list[str]:
    return [] if i in (1, 3, 5, 7) else perfect(i)


def test_a_report_holds_every_check_with_its_threshold_and_value(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with(path, breaks_some, perfect)

    report = gate_report(
        History(path),
        second,
        TASK_SPEC,
        previous=first[:8],
        flip_rate=0.0,
        cost_ratio=0.3,
        p95_latency_ms=900,
    )

    assert report.decision.passed
    names = [check.name for check in report.decision.checks]
    assert names == ["regression_vs_baseline", "flip_rate", "cost_ratio", "p95_latency_ms"]
    assert report.comparison is not None
    assert report.comparison.fixed == 4
    assert report.comparison.broken == 0
    assert report.regressions == ()


def test_regressions_list_the_worst_cases_first(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with(path, perfect, breaks_some)

    report = gate_report(
        History(path),
        second,
        TASK_SPEC,
        previous=first,
        top=3,
        flip_rate=0.0,
        cost_ratio=0.3,
        p95_latency_ms=900,
    )

    assert [item.case_id for item in report.regressions] == ["case-001", "case-003", "case-005"]
    assert report.regressions[0].before == 1.0
    assert report.regressions[0].after == 0.0
    assert report.comparison is not None
    assert report.comparison.broken == 4


def test_a_relative_gate_needs_the_baseline(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    _, second = history_with(path, perfect, perfect)

    with pytest.raises(ValueError, match="--previous"):
        gate_report(
            History(path),
            second,
            TASK_SPEC,
            previous=None,
            flip_rate=0.0,
            cost_ratio=0.3,
            p95_latency_ms=900,
        )


def test_markdown_is_a_pull_request_comment_with_every_number(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with(path, perfect, breaks_some)
    report = gate_report(
        History(path),
        second,
        TASK_SPEC,
        previous=first,
        flip_rate=0.0,
        cost_ratio=0.3,
        p95_latency_ms=900,
    )

    text = to_markdown(report)

    assert text.startswith(MARKER)
    assert "ModelStill gate: failed" in text
    assert "| regression_vs_baseline | >= -0.020 |" in text
    assert "| flip_rate | <= 0.010 | 0.000 |" in text
    assert "| p95_latency_ms | <= 4000 | 900 |" in text
    assert "fail" in text and "pass" in text
    difference = report.comparison
    assert difference is not None
    assert f"{difference.difference:+.3f} [{difference.low:+.3f}, {difference.high:+.3f}]" in text
    assert "0 fixed, 4 broken" in text
    assert "| case-001 | 1.000 | 0.000 |" in text
    assert second[:8] in text and first[:8] in text


def test_json_carries_the_same_decision(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with(path, perfect, breaks_some)
    report = gate_report(
        History(path),
        second,
        TASK_SPEC,
        previous=first,
        flip_rate=0.0,
        cost_ratio=0.3,
        p95_latency_ms=900,
    )

    data = to_json(report)

    assert data["passed"] is False
    assert data["run"]["id"] == second
    assert data["previous"]["id"] == first
    checks = {check["name"]: check for check in data["checks"]}
    regression = checks["regression_vs_baseline"]
    assert regression["threshold"] == -0.02
    assert regression["direction"] == ">="
    assert regression["interval"] == [data["comparison"]["low"], data["comparison"]["high"]]
    assert checks["flip_rate"]["interval"] is None
    assert data["comparison"]["broken"] == 4
    assert data["regressions"][0] == {"case_id": "case-001", "before": 1.0, "after": 0.0}
    json.dumps(data)


def test_an_absolute_gate_shows_the_metric_interval(tmp_path: Path) -> None:
    spec = tmp_path / "spec.yaml"
    spec.write_text(TASK_SPEC.read_text().replace("max_regression: 0.02", "lower_ci_min: 0.5"))
    path = tmp_path / "runs.jsonl"
    history = History(path)
    bench = Benchmark(name="b", cases=tuple(Case(str(i), i, "yes") for i in range(50)))
    entry = history.record(bench, "m", run(bench.cases, model=lambda i: "yes", metric=exact_match))

    report = gate_report(
        history, entry, spec, previous=None, flip_rate=0.0, cost_ratio=0.3, p95_latency_ms=900
    )
    data = to_json(report)

    [lower] = [check for check in data["checks"] if check["name"] == "metric_lower_bound"]
    assert lower["interval"] == [report.metric_low, report.metric_high]
    assert data["comparison"] is None
    assert "Paired comparison" not in to_markdown(report)


def cli_args(path: Path, run_id: str, previous: str, output: str) -> list[str]:
    return [
        "report", "gate", str(path), run_id, "--spec", str(TASK_SPEC), "--previous", previous,
        "--flip-rate", "0", "--cost-ratio", "0.3", "--p95-latency-ms", "900", "--format", output,
    ]  # fmt: skip


def test_cli_prints_markdown_and_exits_zero_when_the_gate_passes(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with(path, breaks_some, perfect)

    assert main(cli_args(path, second, first, "markdown")) == 0

    assert capsys.readouterr().out.startswith(MARKER)


def test_cli_exits_two_when_the_gate_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with(path, perfect, breaks_some)

    assert main(cli_args(path, second, first, "json")) == 2

    assert json.loads(capsys.readouterr().out)["passed"] is False


def test_cli_reports_an_unknown_run(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "runs.jsonl"
    first, _ = history_with(path, perfect, perfect)

    assert main(cli_args(path, "nope", first, "markdown")) == 1
    assert "nope" in capsys.readouterr().err
