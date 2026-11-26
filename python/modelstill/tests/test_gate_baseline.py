import pytest
from pydantic import ValidationError

from modelstill.gate import Measurements, decide
from modelstill.spec import Gate


def measured(difference_low: float | None) -> Measurements:
    return Measurements(
        metric_mean=0.80,
        metric_low=0.76,
        metric_cases=307,
        flip_rate=0.0,
        cost_ratio=0.3,
        p95_latency_ms=900,
        baseline_difference_low=difference_low,
    )


RELATIVE = Gate(
    metric="pooled_f1",
    max_regression=0.02,
    max_flip_rate=0.01,
    max_cost_ratio=0.6,
    max_p95_latency_ms=4000,
)


def test_passes_when_the_interval_rules_out_a_drop_bigger_than_the_margin() -> None:
    decision = decide(RELATIVE, measured(-0.015))

    assert decision.passed
    assert decision.checks[0].name == "regression_vs_baseline"


def test_fails_when_a_drop_bigger_than_the_margin_is_still_possible() -> None:
    decision = decide(RELATIVE, measured(-0.031))

    assert not decision.passed
    failed = [check for check in decision.checks if not check.passed]
    assert [check.name for check in failed] == ["regression_vs_baseline"]
    assert failed[0].threshold == -0.02


def test_a_relative_gate_needs_a_baseline_comparison() -> None:
    with pytest.raises(ValueError, match="baseline"):
        decide(RELATIVE, measured(None))


def test_a_gate_needs_at_least_one_quality_rule() -> None:
    with pytest.raises(ValidationError):
        Gate(metric="f1", max_flip_rate=0.01, max_cost_ratio=0.6, max_p95_latency_ms=4000)


def test_both_rules_can_apply_together() -> None:
    both = RELATIVE.model_copy(update={"lower_ci_min": 0.78})

    decision = decide(both, measured(-0.01))

    names = [check.name for check in decision.checks]
    assert names[:2] == ["metric_lower_bound", "regression_vs_baseline"]
    assert not decision.passed
