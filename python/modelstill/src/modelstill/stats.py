import itertools
import math
import random
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import fmean, variance

from scipy.stats import beta, binomtest, norm


@dataclass(frozen=True)
class Estimate:
    value: float
    low: float
    high: float


@dataclass(frozen=True)
class Deferral:
    threshold: float | None
    coverage: float
    accepted_error_upper: float | None


def _check_counts(successes: int, trials: int) -> None:
    if trials <= 0:
        raise ValueError("trials must be positive")
    if not 0 <= successes <= trials:
        raise ValueError("successes must lie between 0 and trials")


def wilson(successes: int, trials: int, confidence: float = 0.95) -> tuple[float, float]:
    _check_counts(successes, trials)
    z = float(norm.ppf(1 - (1 - confidence) / 2))
    p = successes / trials
    denominator = 1 + z * z / trials
    centre = p + z * z / (2 * trials)
    spread = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials))
    return (centre - spread) / denominator, (centre + spread) / denominator


def clopper_pearson(successes: int, trials: int, confidence: float = 0.95) -> tuple[float, float]:
    _check_counts(successes, trials)
    alpha = 1 - confidence
    low = 0.0 if successes == 0 else float(beta.ppf(alpha / 2, successes, trials - successes + 1))
    high = (
        1.0
        if successes == trials
        else float(beta.ppf(1 - alpha / 2, successes + 1, trials - successes))
    )
    return low, high


def _upper_error_bound(errors: int, trials: int, delta: float) -> float:
    if errors == trials:
        return 1.0
    return float(beta.ppf(1 - delta, errors + 1, trials - errors))


def ppi_mean(
    unlabelled_predictions: list[float],
    labelled_predictions: list[float],
    labelled_truth: list[float],
    confidence: float = 0.95,
) -> Estimate:
    if len(labelled_predictions) != len(labelled_truth):
        raise ValueError("labelled predictions and truth must have the same length")
    if len(labelled_truth) < 2 or len(unlabelled_predictions) < 2:
        raise ValueError("need at least two labelled and two unlabelled items")
    rectifier = [
        truth - pred for truth, pred in zip(labelled_truth, labelled_predictions, strict=True)
    ]
    value = fmean(unlabelled_predictions) + fmean(rectifier)
    spread_squared = variance(unlabelled_predictions) / len(unlabelled_predictions) + variance(
        rectifier
    ) / len(rectifier)
    z = float(norm.ppf(1 - (1 - confidence) / 2))
    half_width = z * math.sqrt(spread_squared)
    return Estimate(value=value, low=value - half_width, high=value + half_width)


def deferral_threshold(
    confidences: list[float],
    correct: list[bool],
    target_error: float,
    delta: float = 0.05,
) -> Deferral:
    if len(confidences) != len(correct):
        raise ValueError("confidences and correctness must have the same length")
    if not confidences:
        return Deferral(threshold=None, coverage=0.0, accepted_error_upper=None)
    smallest_passable = math.ceil(math.log(delta) / math.log(1 - target_error))
    ordered = sorted(zip(confidences, correct, strict=True), key=lambda item: -item[0])
    chosen: float | None = None
    chosen_bound: float | None = None
    accepted = 0
    errors = 0
    index = 0
    while index < len(ordered):
        cut = ordered[index][0]
        while index < len(ordered) and ordered[index][0] == cut:
            accepted += 1
            errors += 0 if ordered[index][1] else 1
            index += 1
        if accepted < smallest_passable:
            continue
        bound = _upper_error_bound(errors, accepted, delta)
        if bound > target_error:
            break
        chosen, chosen_bound = cut, bound
    if chosen is None:
        return Deferral(threshold=None, coverage=0.0, accepted_error_upper=None)
    coverage = sum(1 for confidence in confidences if confidence >= chosen) / len(confidences)
    return Deferral(threshold=chosen, coverage=coverage, accepted_error_upper=chosen_bound)


def bootstrap_interval(
    values: Sequence[float], rng: random.Random, rounds: int
) -> tuple[float, float]:
    size = len(values)
    means = sorted(fmean(rng.choices(values, k=size)) for _ in range(rounds))
    return means[int(0.025 * rounds)], means[int(0.975 * rounds) - 1]


def sign_flip_p(differences: Sequence[float], rounds: int = 10_000, seed: int = 0) -> float:
    if not differences:
        raise ValueError("a sign-flip test needs at least one difference")
    observed = sum(differences) - 1e-12
    if 2 ** len(differences) <= rounds:
        patterns = list(itertools.product((1.0, -1.0), repeat=len(differences)))
        hits = sum(
            1
            for signs in patterns
            if sum(sign * value for sign, value in zip(signs, differences, strict=True)) >= observed
        )
        return hits / len(patterns)
    rng = random.Random(seed)
    hits = sum(
        1
        for _ in range(rounds)
        if sum(value if rng.random() < 0.5 else -value for value in differences) >= observed
    )
    return (1 + hits) / (1 + rounds)


def sign_test(wins: int, losses: int) -> float:
    if wins + losses == 0:
        return 1.0
    return float(binomtest(wins, wins + losses, 0.5, alternative="two-sided").pvalue)


def mcnemar_exact(broken: int, fixed: int) -> float:
    if broken + fixed == 0:
        return 1.0
    return float(binomtest(broken, broken + fixed, 0.5, alternative="greater").pvalue)
