import json
from importlib.metadata import entry_points
from pathlib import Path

import pytest
import yaml

from modelstill.benchmark import History

pytest_plugins = ["pytester"]

GATE = {
    "metric": "tools",
    "max_regression": 0.0,
    "max_flip_rate": 0.05,
    "max_cost_ratio": 1.5,
    "max_p95_latency_ms": 60000,
}

SUITE = """
import pytest


@pytest.mark.modelstill_cases("golden.jsonl")
def test_extracts(case, modelstill_score):
    answer = ANSWERS.get(case.id, case.expected)
    score = 1.0 if answer == case.expected else 0.0
    modelstill_score.record(score, output=answer, length=len(answer))


@pytest.mark.modelstill
def test_marked_plain_test():
    assert PLAIN


def test_not_a_case():
    assert True
"""


def suite(pytester: pytest.Pytester, answers: dict[str, str], plain: bool = True) -> None:
    pytester.makeini("[pytest]\nasyncio_default_fixture_loop_scope = function\n")
    rows = [{"id": f"c{i}", "input": f"text {i}", "expected": f"tool {i}"} for i in range(6)]
    pytester.makefile(".jsonl", golden="\n".join(json.dumps(row) for row in rows))
    pytester.makepyfile(test_suite=f"ANSWERS = {answers!r}\nPLAIN = {plain!r}\n" + SUITE)


def gate(pytester: pytest.Pytester) -> Path:
    path = pytester.path / "gate.yaml"
    path.write_text(yaml.safe_dump(GATE))
    return path


def options(history: Path, *extra: str) -> list[str]:
    return ["--modelstill-history", str(history), "--modelstill-task", "tech", *extra]


def test_the_plugin_is_registered_through_the_pytest11_entry_point() -> None:
    [found] = [e for e in entry_points(group="pytest11") if e.name == "modelstill"]

    assert found.value == "modelstill.pytest_plugin"


def test_without_a_history_nothing_is_recorded(pytester: pytest.Pytester) -> None:
    suite(pytester, {})

    result = pytester.runpytest()

    result.assert_outcomes(passed=8)
    assert [path.name for path in pytester.path.glob("*.jsonl")] == ["golden.jsonl"]


def test_a_session_records_one_run_with_every_case(pytester: pytest.Pytester) -> None:
    suite(pytester, {"c0": "wrong"})
    history = pytester.path / "runs.jsonl"

    result = pytester.runpytest(*options(history, "--modelstill-model", "gpt-5-mini"))

    result.assert_outcomes(passed=8)
    assert result.ret == 0
    [entry] = History(history).runs()
    assert entry.model == "gpt-5-mini"
    assert entry.benchmark == "tech"
    ids = [score.case_id for score in entry.result.scores]
    assert ids == sorted(
        ["c0", "c1", "c2", "c3", "c4", "c5", "test_suite.py::test_marked_plain_test"]
    )
    assert entry.result.mean == pytest.approx(6 / 7)
    assert entry.result.scores[0].output == "wrong"
    assert "length" in entry.metrics
    result.stdout.fnmatch_lines(["*modelstill*", f"recorded {entry.id[:8]} gpt-5-mini*"])


def test_a_failing_marked_test_scores_zero(pytester: pytest.Pytester) -> None:
    suite(pytester, {}, plain=False)
    history = pytester.path / "runs.jsonl"

    result = pytester.runpytest(*options(history))

    result.assert_outcomes(passed=7, failed=1)
    [entry] = History(history).runs()
    plain = next(s for s in entry.result.scores if s.case_id.endswith("test_marked_plain_test"))
    assert plain.score == 0.0
    assert plain.error is not None and "AssertionError" in plain.error


def test_the_gate_fails_the_session_on_a_regression(pytester: pytest.Pytester) -> None:
    suite(pytester, {})
    history = pytester.path / "runs.jsonl"
    pytester.runpytest(*options(history))
    History(history).accept(History(history).runs()[0].id)
    suite(pytester, {"c1": "wrong", "c2": "wrong", "c3": "wrong"})
    gated = options(
        history,
        "--modelstill-gate",
        str(gate(pytester)),
        "--modelstill-flip-rate",
        "0",
        "--modelstill-cost-ratio",
        "1",
    )

    result = pytester.runpytest(*gated)

    result.assert_outcomes(passed=8)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*regression_vs_baseline*FAILED*", "gate FAILED*"])
    [stored] = History(history).gates()
    assert stored["report"]["passed"] is False


def test_the_gate_passes_against_an_equal_baseline(pytester: pytest.Pytester) -> None:
    suite(pytester, {})
    history = pytester.path / "runs.jsonl"
    pytester.runpytest(*options(history))
    History(history).accept(History(history).runs()[0].id)
    gated = options(
        history,
        "--modelstill-gate",
        str(gate(pytester)),
        "--modelstill-flip-rate",
        "0",
        "--modelstill-cost-ratio",
        "1",
    )

    result = pytester.runpytest(*gated)

    assert result.ret == pytest.ExitCode.OK
    result.stdout.fnmatch_lines(["gate passed*"])


def test_a_regression_gate_without_a_baseline_fails_the_session(pytester: pytest.Pytester) -> None:
    suite(pytester, {})
    history = pytester.path / "runs.jsonl"
    gated = options(
        history,
        "--modelstill-gate",
        str(gate(pytester)),
        "--modelstill-flip-rate",
        "0",
        "--modelstill-cost-ratio",
        "1",
    )

    result = pytester.runpytest(*gated)

    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*no accepted baseline*"])


def test_the_gate_needs_the_values_it_cannot_measure(pytester: pytest.Pytester) -> None:
    suite(pytester, {})
    history = pytester.path / "runs.jsonl"

    result = pytester.runpytest(*options(history, "--modelstill-gate", str(gate(pytester))))

    assert result.ret == pytest.ExitCode.USAGE_ERROR
    result.stderr.fnmatch_lines(["*--modelstill-flip-rate*"])
