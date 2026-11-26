import pytest

from modelstill.evals import ScoredCase, mean_interval, summarise


def test_summarise_binary_scores_uses_an_exact_interval() -> None:
    scores = [ScoredCase(str(i), None, 1.0 if i else 0.0) for i in range(50)]

    result = summarise(scores)

    assert result.binary is True
    assert result.mean == pytest.approx(49 / 50)
    assert result.low < result.mean < result.high


def test_summarise_continuous_scores_uses_a_bootstrap_interval() -> None:
    scores = [ScoredCase(str(i), None, (i % 4) / 4) for i in range(80)]

    result = summarise(scores, seed=3)

    assert result.binary is False
    assert result.low < result.mean < result.high


def test_summarise_needs_at_least_one_score() -> None:
    with pytest.raises(ValueError, match="at least one"):
        summarise([])


def test_mean_interval_matches_summarise() -> None:
    values = [0.2, 0.9, 0.4, 0.7]

    estimate = mean_interval(values)

    result = summarise([ScoredCase(str(i), None, v) for i, v in enumerate(values)])
    assert (estimate.value, estimate.low, estimate.high) == (result.mean, result.low, result.high)
