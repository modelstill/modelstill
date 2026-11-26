import random

import pytest

from modelstill.stats import (
    bootstrap_interval,
    clopper_pearson,
    deferral_threshold,
    mcnemar_exact,
    ppi_mean,
    sign_flip_p,
    wilson,
)


def test_wilson_matches_hand_computed_values() -> None:
    low, high = wilson(8, 10)

    assert low == pytest.approx(0.4902, abs=1e-4)
    assert high == pytest.approx(0.9433, abs=1e-4)


def test_clopper_pearson_matches_reference_values() -> None:
    low, high = clopper_pearson(8, 10)

    assert low == pytest.approx(0.4439, abs=1e-4)
    assert high == pytest.approx(0.9748, abs=1e-4)


def test_clopper_pearson_edges() -> None:
    assert clopper_pearson(0, 20)[0] == 0.0
    assert clopper_pearson(20, 20)[1] == 1.0


@pytest.mark.parametrize("interval", [wilson, clopper_pearson])
def test_intervals_reject_impossible_counts(interval) -> None:
    with pytest.raises(ValueError):
        interval(11, 10)
    with pytest.raises(ValueError):
        interval(1, 0)


def test_ppi_point_estimate_matches_hand_computation() -> None:
    estimate = ppi_mean(
        unlabelled_predictions=[1, 1, 0, 1],
        labelled_predictions=[1, 1, 1],
        labelled_truth=[1, 0, 1],
    )

    assert estimate.value == pytest.approx(0.75 - 1 / 3)
    assert estimate.low < estimate.value < estimate.high


def test_ppi_with_a_perfect_judge_equals_the_judge_mean() -> None:
    estimate = ppi_mean(
        unlabelled_predictions=[1, 0, 1, 1, 0, 1, 1, 1],
        labelled_predictions=[1, 0, 1, 1],
        labelled_truth=[1, 0, 1, 1],
    )

    assert estimate.value == pytest.approx(0.75)


def test_ppi_needs_matching_labelled_lists() -> None:
    with pytest.raises(ValueError):
        ppi_mean(unlabelled_predictions=[1, 0], labelled_predictions=[1], labelled_truth=[1, 0])


def synthetic_calibration(n: int, seed: int) -> tuple[list[float], list[bool]]:
    rng = random.Random(seed)
    confidences: list[float] = []
    correct: list[bool] = []
    for _ in range(n):
        confidence = rng.random()
        confidences.append(confidence)
        correct.append(rng.random() < 0.5 + 0.5 * confidence)
    return confidences, correct


def test_deferral_threshold_keeps_error_on_accepted_items_under_target() -> None:
    confidences, correct = synthetic_calibration(4000, seed=7)

    result = deferral_threshold(confidences, correct, target_error=0.10)

    assert result.threshold is not None
    accepted = [ok for c, ok in zip(confidences, correct, strict=True) if c >= result.threshold]
    assert 1 - sum(accepted) / len(accepted) <= 0.10
    assert 0 < result.coverage < 1


def test_deferral_threshold_holds_on_fresh_data() -> None:
    calib_conf, calib_ok = synthetic_calibration(4000, seed=11)
    test_conf, test_ok = synthetic_calibration(20000, seed=12)

    result = deferral_threshold(calib_conf, calib_ok, target_error=0.10)

    assert result.threshold is not None
    accepted = [ok for c, ok in zip(test_conf, test_ok, strict=True) if c >= result.threshold]
    assert 1 - sum(accepted) / len(accepted) <= 0.10


def test_deferral_threshold_defers_everything_when_target_is_unreachable() -> None:
    confidences = [0.9, 0.8, 0.7, 0.6]
    correct = [False, False, True, False]

    result = deferral_threshold(confidences, correct, target_error=0.05)

    assert result.threshold is None
    assert result.coverage == 0.0


def test_sign_flip_enumerates_every_sign_pattern_for_small_samples() -> None:
    assert sign_flip_p([1.0, 2.0, 3.0]) == pytest.approx(1 / 8)
    assert sign_flip_p([1.0, -1.0]) == pytest.approx(3 / 4)


def test_sign_flip_of_no_difference_is_one() -> None:
    assert sign_flip_p([0.0, 0.0, 0.0]) == 1.0


def test_sign_flip_samples_large_inputs_and_never_returns_zero() -> None:
    p = sign_flip_p([0.5] * 30, rounds=2000, seed=1)

    assert p == pytest.approx(1 / 2001)


def test_sign_flip_needs_values() -> None:
    with pytest.raises(ValueError, match="at least one"):
        sign_flip_p([])


def test_mcnemar_exact_is_the_one_sided_binomial_on_discordant_pairs() -> None:
    assert mcnemar_exact(broken=5, fixed=0) == pytest.approx(1 / 32)
    assert mcnemar_exact(broken=3, fixed=3) == pytest.approx(42 / 64)
    assert mcnemar_exact(broken=0, fixed=0) == 1.0


def test_bootstrap_interval_brackets_the_mean() -> None:
    low, high = bootstrap_interval([0.0, 1.0] * 20, random.Random(0), 2000)

    assert low < 0.5 < high
