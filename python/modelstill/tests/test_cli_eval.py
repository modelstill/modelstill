from pathlib import Path

import pytest

from modelstill.benchmark import Benchmark, History
from modelstill.cli import main
from modelstill.evals import Case, exact_match, run

BENCH = Benchmark(name="tech", cases=tuple(Case(str(i), i, "yes") for i in range(200)))


def history_with_two_runs(path: Path) -> tuple[str, str]:
    history = History(path)
    weak = run(BENCH.cases, model=lambda i: "yes" if i % 2 else "no", metric=exact_match)
    strong = run(BENCH.cases, model=lambda i: "yes", metric=exact_match)
    return history.record(BENCH, "student-v1", weak), history.record(BENCH, "student-v2", strong)


def test_lists_runs_with_their_intervals(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with_two_runs(path)

    assert main(["eval", "runs", str(path)]) == 0

    out = capsys.readouterr().out
    assert first[:8] in out and second[:8] in out
    assert "student-v2" in out
    assert "1.000 [0.982, 1.000]" in out


def test_compares_two_runs_case_by_case(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with_two_runs(path)

    assert main(["eval", "compare", str(path), first, second]) == 0

    out = capsys.readouterr().out
    assert "better" in out
    assert "fixed 100" in out
    assert "broken 0" in out


def test_accepts_a_run_as_the_baseline(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "runs.jsonl"
    _, second = history_with_two_runs(path)

    assert main(["eval", "accept", str(path), second]) == 0
    assert History(path).last_accepted(BENCH) is not None


def test_unknown_run_id_is_an_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_two_runs(path)

    assert main(["eval", "accept", str(path), "nope"]) == 1
    assert "nope" in capsys.readouterr().err
