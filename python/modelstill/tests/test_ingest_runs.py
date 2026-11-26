from pathlib import Path

import pytest
import yaml

from modelstill.benchmark import History
from modelstill.ingest.runs import (
    ImportedCase,
    ImportedRun,
    gate_run,
    load_gate,
    p95,
    record_run,
    report_lines,
)
from modelstill.spec import Gate

GATE = Gate(
    metric="tools",
    max_regression=0.05,
    max_flip_rate=0.05,
    max_cost_ratio=1.5,
    max_p95_latency_ms=2000,
)


def imported(model: str, passing: int, total: int = 40) -> ImportedRun:
    return ImportedRun(
        model=model,
        source="deepeval",
        cases=tuple(
            ImportedCase(
                id=f"case-{index:02d}",
                input=f"question {index}",
                expected="yes",
                score=1.0 if index < passing else 0.0,
                output="yes" if index < passing else "no",
                metrics={"relevancy": 0.5 + index / 100},
                latency_ms=100.0 + index,
            )
            for index in reversed(range(total))
        ),
    )


def test_record_run_sorts_cases_and_keeps_metrics_with_intervals(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")

    recorded = record_run(history, "tech", imported("gpt-5-mini", 30))

    entry = recorded.entry
    assert entry.model == "gpt-5-mini"
    assert entry.benchmark == "tech"
    assert [score.case_id for score in entry.result.scores][:2] == ["case-00", "case-01"]
    assert entry.result.mean == pytest.approx(0.75)
    assert entry.result.low < 0.75 < entry.result.high
    relevancy = entry.metrics["relevancy"]
    assert relevancy.low < relevancy.value < relevancy.high
    assert recorded.p95_latency_ms == 137


def test_runs_over_the_same_cases_share_a_benchmark_version(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")

    first = record_run(history, "tech", imported("a", 30))
    second = record_run(history, "tech", imported("b", 10))

    assert first.entry.version == second.entry.version


def test_duplicate_case_ids_are_rejected(tmp_path: Path) -> None:
    run = imported("a", 1, total=1)
    doubled = ImportedRun("a", "deepeval", run.cases * 2)

    with pytest.raises(ValueError, match="case-00"):
        record_run(History(tmp_path / "runs.jsonl"), "tech", doubled)


def test_p95_uses_the_nearest_rank() -> None:
    assert p95([float(v) for v in range(1, 101)]) == 95
    assert p95([]) is None


def test_gate_passes_against_an_equal_baseline_and_is_stored(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    baseline = record_run(history, "tech", imported("a", 36))
    history.accept(baseline.entry.id)
    candidate = record_run(history, "tech", imported("b", 36))

    outcome = gate_run(history, candidate, GATE, flip_rate=0.0, cost_ratio=1.0)

    assert outcome.decision.passed
    assert outcome.baseline is not None and outcome.baseline.id == baseline.entry.id
    assert outcome.comparison is not None
    [stored] = history.gates()
    assert stored["run"] == candidate.entry.id
    assert stored["baseline"] == baseline.entry.id
    assert stored["report"]["passed"] is True
    assert stored["report"]["gate"]["max_regression"] == 0.05
    assert stored["report"]["measurements"]["p95_latency_ms"] == 137


def test_gate_fails_on_a_regression(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    history.accept(record_run(history, "tech", imported("a", 38)).entry.id)
    candidate = record_run(history, "tech", imported("b", 20))

    outcome = gate_run(history, candidate, GATE, flip_rate=0.0, cost_ratio=1.0)

    assert not outcome.decision.passed
    failed = [check.name for check in outcome.decision.checks if not check.passed]
    assert failed == ["regression_vs_baseline"]
    assert any("FAILED" in line for line in report_lines(candidate, outcome))


def test_a_regression_gate_without_an_accepted_baseline_is_an_error(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    candidate = record_run(history, "tech", imported("b", 20))

    with pytest.raises(ValueError, match="eval accept"):
        gate_run(history, candidate, GATE, flip_rate=0.0, cost_ratio=1.0)


def test_latency_must_be_measured_or_given(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    run = ImportedRun("a", "x", (ImportedCase("1", "q", "a", 1.0),))
    gate = GATE.model_copy(update={"max_regression": None, "lower_ci_min": 0.0})
    candidate = record_run(history, "tech", run)

    with pytest.raises(ValueError, match="p95"):
        gate_run(history, candidate, gate, flip_rate=0.0, cost_ratio=1.0)
    assert gate_run(history, candidate, gate, 0.0, 1.0, p95_latency_ms=10).decision.passed


def test_load_gate_reads_a_task_spec_or_a_bare_gate(tmp_path: Path) -> None:
    bare = tmp_path / "gate.yaml"
    bare.write_text(yaml.safe_dump(GATE.model_dump(exclude_none=True)))
    nested = tmp_path / "nested.yaml"
    nested.write_text(yaml.safe_dump({"gate": GATE.model_dump(exclude_none=True)}))

    assert load_gate(bare) == GATE
    assert load_gate(nested) == GATE
    spec = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"
    assert load_gate(spec).metric
