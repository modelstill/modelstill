import json
from pathlib import Path

import pytest

from modelstill.benchmark import Benchmark, History, load_benchmark
from modelstill.evals import Case, exact_match, run


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    return path


ROWS = [
    {"id": "a", "input": "Python and SQL", "expected": ["python", "sql"], "tags": ["easy"]},
    {"id": "b", "input": "Excel at sales", "expected": [], "tags": ["homograph"]},
]


def test_loads_cases_with_tags(tmp_path: Path) -> None:
    benchmark = load_benchmark(write_jsonl(tmp_path / "tech.jsonl", ROWS))

    assert benchmark.name == "tech"
    assert [case.id for case in benchmark.cases] == ["a", "b"]
    assert benchmark.cases[1].tags == ("homograph",)


def test_version_hash_is_stable_and_content_based(tmp_path: Path) -> None:
    first = load_benchmark(write_jsonl(tmp_path / "one.jsonl", ROWS))
    second = load_benchmark(write_jsonl(tmp_path / "two.jsonl", [dict(row) for row in ROWS]))
    changed = load_benchmark(
        write_jsonl(tmp_path / "three.jsonl", [ROWS[0], {**ROWS[1], "expected": ["excel"]}])
    )

    assert first.version == second.version
    assert first.version != changed.version
    assert len(first.version) == 64


def test_rejects_duplicate_ids(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="duplicate"):
        load_benchmark(write_jsonl(tmp_path / "dup.jsonl", [ROWS[0], ROWS[0]]))


def test_rejects_rows_without_an_id(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="id"):
        load_benchmark(write_jsonl(tmp_path / "bad.jsonl", [{"input": "x", "expected": "y"}]))


def test_slices_by_tag() -> None:
    benchmark = Benchmark(
        name="tech",
        cases=(Case("a", "x", "y", ("easy",)), Case("b", "x", "y", ("hard",))),
    )

    assert [case.id for case in benchmark.tagged("hard").cases] == ["b"]


def test_history_records_runs_and_finds_the_last_accepted_one(tmp_path: Path) -> None:
    benchmark = Benchmark(name="t", cases=tuple(Case(str(i), str(i), "yes") for i in range(20)))
    history = History(tmp_path / "runs.jsonl")
    first = run(benchmark.cases, model=lambda text: "yes", metric=exact_match)
    second = run(benchmark.cases, model=lambda text: "no", metric=exact_match)

    first_id = history.record(benchmark, "student-v1", first)
    history.record(benchmark, "student-v2", second)
    history.accept(first_id)

    baseline = history.last_accepted(benchmark)
    assert baseline is not None
    assert baseline.model == "student-v1"
    assert baseline.result.mean == first.mean
    assert [score.case_id for score in baseline.result.scores] == [str(i) for i in range(20)]


def test_history_ignores_runs_on_another_benchmark_version(tmp_path: Path) -> None:
    old = Benchmark(name="t", cases=(Case("a", "x", "y"),))
    new = Benchmark(name="t", cases=(Case("a", "x", "z"),))
    history = History(tmp_path / "runs.jsonl")
    history.accept(
        history.record(old, "m", run(old.cases, model=lambda t: "y", metric=exact_match))
    )

    assert history.last_accepted(new) is None


def test_history_survives_reopening(tmp_path: Path) -> None:
    benchmark = Benchmark(name="t", cases=(Case("a", "x", "y"),))
    path = tmp_path / "runs.jsonl"
    History(path).accept(
        History(path).record(
            benchmark, "m", run(benchmark.cases, model=lambda t: "y", metric=exact_match)
        )
    )

    assert History(path).last_accepted(benchmark) is not None


def test_accepting_an_unknown_run_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(KeyError):
        History(tmp_path / "runs.jsonl").accept("missing")


def test_history_keeps_each_case_input_expected_and_metrics(tmp_path: Path) -> None:
    benchmark = load_benchmark(write_jsonl(tmp_path / "tech.jsonl", ROWS))
    result = run(benchmark.cases, model=lambda text: [], metric=exact_match)
    history = History(tmp_path / "runs.jsonl")

    run_id = history.record(benchmark, "m", result, case_metrics={"a": {"set_f1": 0.5}})

    details = history.get(run_id).details
    assert details["a"].input == "Python and SQL"
    assert details["a"].expected == ["python", "sql"]
    assert details["a"].metrics == {"set_f1": 0.5}
    assert details["b"].metrics == {}


def test_history_written_before_case_details_still_reads(tmp_path: Path) -> None:
    row = {
        "kind": "run",
        "id": "abc",
        "model": "m",
        "benchmark": "tech",
        "version": "v",
        "created_at": "2026-11-01T00:00:00+00:00",
        "result": {
            "mean": 1.0,
            "low": 0.5,
            "high": 1.0,
            "binary": True,
            "scores": [{"case_id": "a", "output": [], "score": 1.0, "error": None}],
        },
    }
    path = write_jsonl(tmp_path / "runs.jsonl", [row])

    entry = History(path).get("abc")

    assert entry.details == {}
    assert entry.metrics == {}


def test_a_run_can_be_recorded_under_a_given_id(tmp_path: Path) -> None:
    benchmark = load_benchmark(write_jsonl(tmp_path / "tech.jsonl", ROWS))
    result = run(benchmark.cases, lambda _: [], exact_match)
    history = History(tmp_path / "runs.jsonl")

    assert history.record(benchmark, "m", result, run_id="0123456789abcdef") == "0123456789abcdef"
    assert history.get("01234567").model == "m"
