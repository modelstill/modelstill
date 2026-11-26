from pathlib import Path

import pytest

from modelstill.benchmark import Benchmark, History
from modelstill.cli import main
from modelstill.evals import Case, micro_f1, run, set_f1

CASES = tuple(Case(str(i), i, ["a"] if i % 2 else []) for i in range(40))
BENCH = Benchmark(name="tech", cases=CASES)


def test_records_and_reads_back_named_metrics(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    result = run(CASES, model=lambda i: [], metric=set_f1)
    pooled = micro_f1(CASES, result)

    run_id = history.record(BENCH, "student", result, metrics={"pooled_f1": pooled})

    stored = history.get(run_id).metrics["pooled_f1"]
    assert stored.value == pooled.f1 == 0.0
    assert (stored.low, stored.high) == (pooled.low, pooled.high)


def test_runs_without_metrics_still_load(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    run_id = history.record(BENCH, "student", run(CASES, model=lambda i: [], metric=set_f1))

    assert history.get(run_id).metrics == {}


def test_listing_shows_the_headline_metric(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    result = run(CASES, model=lambda i: ["a"], metric=set_f1)
    History(path).record(BENCH, "student", result, metrics={"pooled_f1": micro_f1(CASES, result)})

    assert main(["eval", "runs", str(path)]) == 0

    out = capsys.readouterr().out
    assert "pooled_f1 0.667" in out


def test_runs_can_be_found_by_a_unique_id_prefix(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    run_id = history.record(BENCH, "student", run(CASES, model=lambda i: [], metric=set_f1))

    assert history.get(run_id[:8]).id == run_id
    with pytest.raises(KeyError):
        history.get("")
