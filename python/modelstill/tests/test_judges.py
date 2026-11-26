import itertools

import pytest

from modelstill.evals import Case, run
from modelstill.judges import (
    JudgeError,
    JudgePanel,
    LLMJudge,
    as_metric,
    corrected_score,
    stability,
)


class Fixed:
    def __init__(self, family: str, verdict: bool) -> None:
        self.name = f"{family}-judge"
        self.family = family
        self.verdict = verdict

    def __call__(self, output: object, expected: object) -> bool:
        return self.verdict


def test_panel_takes_the_majority() -> None:
    panel = JudgePanel([Fixed("gemma", True), Fixed("llama", True), Fixed("mistral", False)])

    assert panel("x", "y") is True


def test_panel_tie_fails_the_output() -> None:
    panel = JudgePanel([Fixed("gemma", True), Fixed("llama", False)])

    assert panel("x", "y") is False


def test_panel_rejects_two_judges_from_one_family() -> None:
    with pytest.raises(ValueError, match="family"):
        JudgePanel([Fixed("gemma", True), Fixed("gemma", False)])


def test_panel_rejects_a_judge_from_a_teacher_family() -> None:
    with pytest.raises(ValueError, match="teacher"):
        JudgePanel([Fixed("qwen", True)], teacher_families={"qwen", "deepseek"})


def completion(reply: str):
    calls: list[list[dict[str, str]]] = []

    def complete(model: str, messages: list[dict[str, str]]) -> str:
        calls.append(messages)
        return reply

    return complete, calls


@pytest.mark.parametrize(
    ("reply", "verdict"),
    [("PASS", True), ("FAIL", False), ("Reasoning first.\nVERDICT: PASS", True), (" fail ", False)],
)
def test_llm_judge_reads_the_verdict(reply: str, verdict: bool) -> None:
    complete, _ = completion(reply)
    judge = LLMJudge(
        model="gemma-4", family="gemma", instructions="Is it right?", complete=complete
    )

    assert judge("Python", "Python") is verdict


def test_llm_judge_sends_instructions_output_and_reference() -> None:
    complete, calls = completion("PASS")
    judge = LLMJudge(model="m", family="f", instructions="Grade strictly.", complete=complete)

    judge({"technologies": ["Python"]}, {"technologies": ["Python"]})

    text = " ".join(message["content"] for message in calls[0])
    assert "Grade strictly." in text
    assert "Python" in text
    assert calls[0][-1]["role"] == "user"


def test_llm_judge_refuses_an_unreadable_reply() -> None:
    complete, _ = completion("maybe")
    judge = LLMJudge(model="m", family="f", instructions="?", complete=complete)

    with pytest.raises(JudgeError):
        judge("a", "b")


def test_a_judge_can_score_a_run() -> None:
    cases = [Case(str(i), i, "yes") for i in range(40)]

    result = run(cases, model=lambda i: "yes", metric=as_metric(Fixed("gemma", True)))

    assert result.mean == 1.0


def test_stability_counts_items_where_repeated_verdicts_disagree() -> None:
    answers = itertools.cycle([True, False, True])

    class Flaky:
        name, family = "flaky", "x"

        def __call__(self, output: object, expected: object) -> bool:
            return next(answers) if output == "unsure" else True

    items = [("sure", "y")] * 8 + [("unsure", "y")] * 2

    report = stability(Flaky(), items, repeats=3)

    assert report.flip_rate == pytest.approx(0.2)
    assert report.unstable == 2


def test_corrected_score_uses_human_labels_to_remove_judge_bias() -> None:
    judge_scores = {str(i): 1.0 for i in range(100)}
    human_labels = {str(i): (i % 2 == 0) for i in range(20)}

    estimate = corrected_score(judge_scores, human_labels)

    assert estimate.value == pytest.approx(0.5)
    assert estimate.low < 0.5 < estimate.high


def test_corrected_score_needs_human_labels_on_judged_items() -> None:
    with pytest.raises(ValueError, match="judged"):
        corrected_score({"a": 1.0, "b": 0.0}, {"zzz": True, "yyy": False})
