from pathlib import Path

from modelstill.benchmark import Benchmark, History
from modelstill.evals import Case, exact_match, run

BENCH = Benchmark(name="tech", cases=tuple(Case(str(i), i, "yes") for i in range(5)))


def test_gate_rows_are_kept_next_to_runs_without_changing_them(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    run_id = history.record(BENCH, "m", run(BENCH.cases, lambda _: "yes", exact_match))
    history.accept(run_id)

    history.record_gate(run_id, None, {"passed": True, "checks": []})

    assert [entry.id for entry in history.runs()] == [run_id]
    assert history.last_accepted(BENCH) is not None
    [gate] = history.gates()
    assert gate["run"] == run_id
    assert gate["baseline"] is None
    assert gate["report"] == {"passed": True, "checks": []}
