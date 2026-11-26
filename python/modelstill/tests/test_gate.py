import pytest

from modelstill.evals import Case, exact_match, run, set_f1
from modelstill.gate import Measurements, decide
from modelstill.spec import Gate

GATE = Gate(
    metric="correct_technologies",
    lower_ci_min=0.80,
    max_flip_rate=0.01,
    max_cost_ratio=0.60,
    max_p95_latency_ms=4000,
)


def binary_run(correct: int, total: int):
    cases = [Case(str(i), i, "yes") for i in range(total)]
    return run(cases, model=lambda i: "yes" if i < correct else "no", metric=exact_match)


def measured(result=None, **change) -> Measurements:
    base = Measurements.from_run(
        result if result is not None else binary_run(290, 300),
        flip_rate=0.004,
        cost_ratio=0.35,
        p95_latency_ms=1800,
    )
    return base.model_copy(update=change)


def test_a_good_candidate_passes_and_records_every_check() -> None:
    decision = decide(GATE, measured())

    assert decision.passed
    names = {check.name for check in decision.checks}
    assert names == {"metric_lower_bound", "flip_rate", "cost_ratio", "p95_latency_ms"}
    lower = next(check for check in decision.checks if check.name == "metric_lower_bound")
    assert lower.threshold == 0.80
    assert 0.80 < lower.value < 290 / 300


@pytest.mark.parametrize(
    ("measurements", "failing"),
    [
        (lambda: measured(binary_run(230, 300)), "metric_lower_bound"),
        (lambda: measured(flip_rate=0.02), "flip_rate"),
        (lambda: measured(cost_ratio=0.9), "cost_ratio"),
        (lambda: measured(p95_latency_ms=5000), "p95_latency_ms"),
    ],
)
def test_each_threshold_can_fail_the_gate_on_its_own(measurements, failing: str) -> None:
    decision = decide(GATE, measurements())

    assert not decision.passed
    assert [check.name for check in decision.checks if not check.passed] == [failing]


def test_small_test_sets_fail_even_with_a_perfect_score() -> None:
    assert not decide(GATE, measured(binary_run(10, 10))).passed


def test_gates_a_continuous_metric_on_its_bootstrap_lower_bound() -> None:
    cases = [Case(str(i), i, ["python", "sql"]) for i in range(300)]
    result = run(
        cases,
        model=lambda i: ["python", "sql"] if i % 10 else ["python"],
        metric=set_f1,
        seed=2,
    )

    decision = decide(GATE, measured(result))

    lower = next(check for check in decision.checks if check.name == "metric_lower_bound")
    assert lower.value == pytest.approx(result.low)
    assert decision.passed


def test_report_is_plain_data_for_storage() -> None:
    report = decide(GATE, measured()).to_report()

    assert report["passed"] is True
    assert report["checks"][0].keys() == {"name", "threshold", "value", "passed"}
