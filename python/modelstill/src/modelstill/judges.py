import json
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from modelstill.benchmark import HistoryEntry
from modelstill.evals import Metric
from modelstill.stats import Estimate, clopper_pearson, ppi_mean, sign_test


class Judge(Protocol):
    name: str
    family: str

    def __call__(self, output: Any, expected: Any) -> bool: ...


class JudgeError(Exception):
    pass


def check_independent(families: Iterable[str], teacher_families: Iterable[str]) -> None:
    overlap = set(families) & set(teacher_families)
    if overlap:
        raise ValueError(f"judge family {sorted(overlap)} is also a teacher family")


class JudgePanel:
    def __init__(self, judges: Sequence[Judge], teacher_families: Iterable[str] = ()) -> None:
        families = [judge.family for judge in judges]
        if len(set(families)) != len(families):
            raise ValueError("a panel may hold at most one judge per model family")
        check_independent(families, teacher_families)
        self._judges = list(judges)
        self.name = "panel(" + ",".join(judge.name for judge in judges) + ")"
        self.family = "panel"

    def __call__(self, output: Any, expected: Any) -> bool:
        passes = sum(1 for judge in self._judges if judge(output, expected))
        return passes * 2 > len(self._judges)


Complete = Callable[[str, list[dict[str, str]]], str]
_VERDICT = re.compile(r"\b(PASS|FAIL)\b", re.IGNORECASE)


def _render(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, sort_keys=True, default=str)


@dataclass
class LLMJudge:
    model: str
    family: str
    instructions: str
    complete: Complete

    @property
    def name(self) -> str:
        return self.model

    def __call__(self, output: Any, expected: Any) -> bool:
        messages = [
            {
                "role": "system",
                "content": f"{self.instructions}\nEnd your reply with PASS or FAIL.",
            },
            {
                "role": "user",
                "content": f"Reference:\n{_render(expected)}\n\nOutput:\n{_render(output)}",
            },
        ]
        found = _VERDICT.findall(self.complete(self.model, messages))
        if not found:
            raise JudgeError(f"{self.model} gave no PASS or FAIL")
        return found[-1].upper() == "PASS"


def as_metric(judge: Judge) -> Metric:
    return lambda output, expected: 1.0 if judge(output, expected) else 0.0


@dataclass(frozen=True)
class Stability:
    flip_rate: float
    unstable: int
    items: int


def stability(judge: Judge, items: Sequence[tuple[Any, Any]], repeats: int = 3) -> Stability:
    if repeats < 2:
        raise ValueError("stability needs at least two repeats")
    unstable = sum(
        1
        for output, expected in items
        if len({judge(output, expected) for _ in range(repeats)}) > 1
    )
    return Stability(flip_rate=unstable / len(items), unstable=unstable, items=len(items))


def corrected_score(
    judge_scores: Mapping[str, float], human_labels: Mapping[str, bool]
) -> Estimate:
    if not set(human_labels) <= set(judge_scores):
        raise ValueError("every human label must be on a judged item")
    labelled = list(human_labels)
    unlabelled = [key for key in judge_scores if key not in human_labels]
    return ppi_mean(
        unlabelled_predictions=[judge_scores[key] for key in unlabelled],
        labelled_predictions=[judge_scores[key] for key in labelled],
        labelled_truth=[1.0 if human_labels[key] else 0.0 for key in labelled],
    )


Preference = Literal["a", "b", "tie"]
Direction = Literal["better", "worse", "no_detectable_difference"]
_PREFERENCE = re.compile(r"\b(A|B|TIE|[Tt]ie)\b")
_SWAPPED: dict[Preference, Preference] = {"a": "b", "b": "a", "tie": "tie"}


@dataclass(frozen=True)
class PairwiseVerdict:
    preference: Preference
    consistent: bool
    forward: Preference
    backward: Preference


@dataclass(frozen=True)
class PairwiseCase:
    id: str
    input: Any
    a: Any
    b: Any
    reference: Any = None


def _pairwise_messages(
    instructions: str, input: Any, first: Any, second: Any, reference: Any
) -> list[dict[str, str]]:
    asked = "" if input is None else f"Input:\n{_render(input)}\n\n"
    shown = "" if reference is None else f"Reference:\n{_render(reference)}\n\n"
    return [
        {
            "role": "system",
            "content": (
                f"{instructions}\nTwo answers to the same input follow. "
                "End your reply with A, B or TIE."
            ),
        },
        {
            "role": "user",
            "content": (
                f"{asked}{shown}Answer A:\n{_render(first)}\n\nAnswer B:\n{_render(second)}"
            ),
        },
    ]


@dataclass
class PairwiseJudge:
    model: str
    family: str
    instructions: str
    complete: Complete

    @property
    def name(self) -> str:
        return self.model

    def prefer(self, input: Any, first: Any, second: Any, reference: Any = None) -> Preference:
        messages = _pairwise_messages(self.instructions, input, first, second, reference)
        found = _PREFERENCE.findall(self.complete(self.model, messages))
        if not found:
            raise JudgeError(f"{self.model} gave no A, B or TIE")
        last = found[-1].lower()
        return "a" if last == "a" else "b" if last == "b" else "tie"

    def __call__(self, input: Any, a: Any, b: Any, reference: Any = None) -> PairwiseVerdict:
        forward = self.prefer(input, a, b, reference)
        backward = _SWAPPED[self.prefer(input, b, a, reference)]
        consistent = forward == backward
        return PairwiseVerdict(
            preference=forward if consistent else "tie",
            consistent=consistent,
            forward=forward,
            backward=backward,
        )


@dataclass(frozen=True)
class PairwiseResult:
    items: int
    wins_a: int
    wins_b: int
    ties: int
    inconsistent: int
    win_rate: float | None
    low: float | None
    high: float | None
    p_value: float
    verdict: Direction
    inconsistency_rate: float
    inconsistency_low: float
    inconsistency_high: float
    verdicts: tuple[PairwiseVerdict, ...]


def pairwise_cases(before: HistoryEntry, after: HistoryEntry) -> list[PairwiseCase]:
    earlier = {score.case_id: score for score in before.result.scores}
    cases: list[PairwiseCase] = []
    for score in after.result.scores:
        if score.case_id not in earlier:
            continue
        detail = after.details.get(score.case_id) or before.details.get(score.case_id)
        cases.append(
            PairwiseCase(
                id=score.case_id,
                input=None if detail is None else detail.input,
                a=earlier[score.case_id].output,
                b=score.output,
                reference=None if detail is None else detail.expected,
            )
        )
    if not cases:
        raise ValueError(f"runs {before.id[:8]} and {after.id[:8]} have no cases in common")
    return cases


def parity_metric(judge: PairwiseJudge, *, teacher_families: Iterable[str]) -> Metric:
    check_independent([judge.family], teacher_families)
    return lambda output, expected: 0.0 if judge(None, output, expected).preference == "b" else 1.0


def _direction(low: float | None, high: float | None) -> Direction:
    if low is not None and low > 0.5:
        return "better"
    if high is not None and high < 0.5:
        return "worse"
    return "no_detectable_difference"


def pairwise_compare(
    judge: PairwiseJudge, cases: Sequence[PairwiseCase], *, teacher_families: Iterable[str]
) -> PairwiseResult:
    check_independent([judge.family], teacher_families)
    if not cases:
        raise ValueError("a pairwise comparison needs at least one case")
    verdicts = tuple(judge(case.input, case.a, case.b, case.reference) for case in cases)
    wins_a = sum(1 for verdict in verdicts if verdict.preference == "a")
    wins_b = sum(1 for verdict in verdicts if verdict.preference == "b")
    inconsistent = sum(1 for verdict in verdicts if not verdict.consistent)
    decisive = wins_a + wins_b
    low, high = clopper_pearson(wins_b, decisive) if decisive else (None, None)
    flip_low, flip_high = clopper_pearson(inconsistent, len(verdicts))
    return PairwiseResult(
        items=len(verdicts),
        wins_a=wins_a,
        wins_b=wins_b,
        ties=len(verdicts) - decisive,
        inconsistent=inconsistent,
        win_rate=wins_b / decisive if decisive else None,
        low=low,
        high=high,
        p_value=sign_test(wins_b, wins_a),
        verdict=_direction(low, high),
        inconsistency_rate=inconsistent / len(verdicts),
        inconsistency_low=flip_low,
        inconsistency_high=flip_high,
        verdicts=verdicts,
    )
