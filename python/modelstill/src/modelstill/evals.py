import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from statistics import fmean
from typing import Any, Literal

from modelstill.stats import Estimate, bootstrap_interval, clopper_pearson


@dataclass(frozen=True)
class Case:
    id: str
    input: Any
    expected: Any
    tags: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ScoredCase:
    case_id: str
    output: Any
    score: float
    error: str | None = None


@dataclass(frozen=True)
class RunResult:
    scores: tuple[ScoredCase, ...]
    mean: float
    low: float
    high: float
    binary: bool


@dataclass(frozen=True)
class Comparison:
    difference: float
    low: float
    high: float
    verdict: Literal["better", "worse", "no_detectable_difference"]
    fixed: int
    broken: int


@dataclass(frozen=True)
class JudgeAgreement:
    accuracy: float
    low: float
    high: float
    kappa: float
    false_pass: int
    false_fail: int


Metric = Callable[[Any, Any], float]


def exact_match(output: Any, expected: Any) -> float:
    return 1.0 if output == expected else 0.0


def set_f1(output: Sequence[str], expected: Sequence[str]) -> float:
    predicted, truth = set(output), set(expected)
    if not predicted and not truth:
        return 1.0
    overlap = len(predicted & truth)
    if overlap == 0:
        return 0.0
    precision, recall = overlap / len(predicted), overlap / len(truth)
    return 2 * precision * recall / (precision + recall)


def run(
    cases: Sequence[Case],
    model: Callable[[Any], Any],
    metric: Metric,
    seed: int = 0,
    rounds: int = 2000,
) -> RunResult:
    if not cases:
        raise ValueError("a run needs at least one case")
    scored: list[ScoredCase] = []
    for case in cases:
        try:
            output = model(case.input)
        except Exception as error:  # noqa: BLE001
            scored.append(ScoredCase(case.id, None, 0.0, f"{type(error).__name__}: {error}"))
            continue
        scored.append(ScoredCase(case.id, output, float(metric(output, case.expected))))
    return summarise(scored, seed, rounds)


def _is_binary(values: Sequence[float]) -> bool:
    return all(value in (0.0, 1.0) for value in values)


def mean_interval(values: Sequence[float], seed: int = 0, rounds: int = 2000) -> Estimate:
    if not values:
        raise ValueError("an interval needs at least one value")
    if _is_binary(values):
        low, high = clopper_pearson(int(sum(values)), len(values))
    else:
        low, high = bootstrap_interval(values, random.Random(seed), rounds)
    return Estimate(fmean(values), low, high)


def summarise(scores: Sequence[ScoredCase], seed: int = 0, rounds: int = 2000) -> RunResult:
    if not scores:
        raise ValueError("a run needs at least one scored case")
    values = [item.score for item in scores]
    estimate = mean_interval(values, seed, rounds)
    return RunResult(tuple(scores), estimate.value, estimate.low, estimate.high, _is_binary(values))


def compare(before: RunResult, after: RunResult, seed: int = 0, rounds: int = 2000) -> Comparison:
    if [item.case_id for item in before.scores] != [item.case_id for item in after.scores]:
        raise ValueError("both runs must score the same cases in the same order")
    differences = [
        new.score - old.score for old, new in zip(before.scores, after.scores, strict=True)
    ]
    low, high = bootstrap_interval(differences, random.Random(seed), rounds)
    verdict: Literal["better", "worse", "no_detectable_difference"] = (
        "better" if low > 0 else "worse" if high < 0 else "no_detectable_difference"
    )
    return Comparison(
        difference=fmean(differences),
        low=low,
        high=high,
        verdict=verdict,
        fixed=sum(1 for value in differences if value > 0),
        broken=sum(1 for value in differences if value < 0),
    )


def judge_agreement(judge: Sequence[bool], human: Sequence[bool]) -> JudgeAgreement:
    if len(judge) != len(human) or not human:
        raise ValueError("judge and human labels must be paired and non-empty")
    total = len(human)
    agreed = sum(1 for verdict, truth in zip(judge, human, strict=True) if verdict == truth)
    low, high = clopper_pearson(agreed, total)
    observed = agreed / total
    judge_pass, human_pass = sum(judge) / total, sum(human) / total
    chance = judge_pass * human_pass + (1 - judge_pass) * (1 - human_pass)
    kappa = 1.0 if chance == 1 else (observed - chance) / (1 - chance)
    return JudgeAgreement(
        accuracy=observed,
        low=low,
        high=high,
        kappa=kappa,
        false_pass=sum(1 for v, t in zip(judge, human, strict=True) if v and not t),
        false_fail=sum(1 for v, t in zip(judge, human, strict=True) if t and not v),
    )


@dataclass(frozen=True)
class PooledF1:
    precision: float
    recall: float
    f1: float
    low: float
    high: float


def _pooled(counts: Sequence[tuple[int, int, int]]) -> tuple[float, float, float]:
    hits = sum(count[0] for count in counts)
    predicted = sum(count[1] for count in counts)
    truth = sum(count[2] for count in counts)
    precision = hits / predicted if predicted else 1.0
    recall = hits / truth if truth else 1.0
    f1 = 0.0 if hits == 0 else 2 * precision * recall / (precision + recall)
    return precision, recall, f1


Matcher = Callable[[set[Any], set[Any]], int]


def exact_hits(predicted: set[Any], truth: set[Any]) -> int:
    return len(predicted & truth)


def micro_f1(
    cases: Sequence[Case],
    result: RunResult,
    seed: int = 0,
    rounds: int = 2000,
    match: Matcher = exact_hits,
) -> PooledF1:
    by_id = {score.case_id: score for score in result.scores}
    counts: list[tuple[int, int, int]] = []
    for case in cases:
        scored = by_id[case.id]
        predicted = set(scored.output) if scored.error is None and scored.output else set()
        truth = set(case.expected or ())
        counts.append((match(predicted, truth), len(predicted), len(truth)))
    precision, recall, f1 = _pooled(counts)
    rng = random.Random(seed)
    samples = sorted(_pooled(rng.choices(counts, k=len(counts)))[2] for _ in range(rounds))
    return PooledF1(
        precision=precision,
        recall=recall,
        f1=f1,
        low=samples[int(0.025 * rounds)],
        high=samples[int(0.975 * rounds) - 1],
    )
