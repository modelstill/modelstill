import pytest

from modelstill.evals import (
    Case,
    compare,
    exact_match,
    judge_agreement,
    run,
    set_f1,
)

CASES = [Case(id=str(index), input=f"q{index}", expected="yes") for index in range(200)]


def test_exact_match_scores_one_or_zero() -> None:
    assert exact_match("Snowflake", "Snowflake") == 1.0
    assert exact_match("snowflake", "Snowflake") == 0.0


def test_set_f1_handles_partial_overlap_and_empty_sets() -> None:
    assert set_f1(["python", "sql"], ["python", "aws"]) == pytest.approx(0.5)
    assert set_f1([], []) == 1.0
    assert set_f1(["python"], []) == 0.0


def test_run_scores_every_case_and_reports_an_interval() -> None:
    result = run(CASES, model=lambda text: "yes" if text != "q0" else "no", metric=exact_match)

    assert len(result.scores) == 200
    assert result.mean == pytest.approx(199 / 200)
    assert result.low < result.mean <= result.high
    assert result.binary is True


def test_run_on_continuous_scores_uses_a_bootstrap_interval() -> None:
    cases = [Case(id=str(i), input=str(i), expected=["a", "b"]) for i in range(100)]

    result = run(cases, model=lambda text: ["a"], metric=set_f1, seed=1)

    assert result.binary is False
    assert result.mean == pytest.approx(2 / 3)
    assert result.low == pytest.approx(2 / 3)
    assert result.high == pytest.approx(2 / 3)


def test_run_records_a_model_error_as_a_zero_score_with_the_error() -> None:
    def broken(text: str) -> str:
        if text == "q5":
            raise RuntimeError("timeout")
        return "yes"

    result = run(CASES, model=broken, metric=exact_match)

    failed = next(score for score in result.scores if score.case_id == "5")
    assert failed.score == 0.0
    assert failed.error == "RuntimeError: timeout"


def test_compare_finds_a_clear_improvement_and_counts_flips() -> None:
    old = run(CASES, model=lambda text: "yes" if int(text[1:]) % 2 else "no", metric=exact_match)
    new = run(CASES, model=lambda text: "yes", metric=exact_match)

    comparison = compare(old, new, seed=3)

    assert comparison.difference == pytest.approx(0.5)
    assert comparison.low > 0
    assert comparison.verdict == "better"
    assert comparison.fixed == 100
    assert comparison.broken == 0


def test_compare_reports_no_detectable_difference_for_identical_runs() -> None:
    result = run(CASES, model=lambda text: "yes" if int(text[1:]) % 3 else "no", metric=exact_match)

    comparison = compare(result, result, seed=3)

    assert comparison.difference == 0
    assert comparison.verdict == "no_detectable_difference"


def test_compare_refuses_runs_over_different_cases() -> None:
    first = run(CASES[:10], model=lambda text: "yes", metric=exact_match)
    second = run(CASES[10:20], model=lambda text: "yes", metric=exact_match)

    with pytest.raises(ValueError, match="same cases"):
        compare(first, second)


def test_judge_agreement_measures_accuracy_and_chance_corrected_agreement() -> None:
    human = [True] * 50 + [False] * 50
    judge = [True] * 45 + [False] * 5 + [False] * 40 + [True] * 10

    report = judge_agreement(judge, human)

    assert report.accuracy == pytest.approx(0.85)
    assert report.low < 0.85 < report.high
    assert report.kappa == pytest.approx(0.70)
    assert report.false_pass == 10
    assert report.false_fail == 5


def test_judge_agreement_needs_paired_labels() -> None:
    with pytest.raises(ValueError):
        judge_agreement([True], [True, False])
