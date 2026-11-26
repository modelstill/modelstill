from collections.abc import Callable
from pathlib import Path

import pytest

from modelstill.benchmark import Benchmark, History
from modelstill.evals import Case, exact_match, run
from modelstill.judges import (
    JudgeError,
    PairwiseCase,
    PairwiseJudge,
    PairwiseVerdict,
    pairwise_cases,
    pairwise_compare,
    parity_metric,
)
from modelstill.stats import clopper_pearson, sign_test

Messages = list[dict[str, str]]


def answers(messages: Messages) -> tuple[str, str]:
    text = messages[-1]["content"]
    first = text.split("Answer A:\n", 1)[1].split("\n\nAnswer B:\n", 1)[0]
    second = text.split("Answer B:\n", 1)[1]
    return first, second


def fake_judge(
    pick: Callable[[str, str], str], calls: list[Messages] | None = None
) -> PairwiseJudge:
    def complete(model: str, messages: Messages) -> str:
        if calls is not None:
            calls.append(messages)
        return f"Reasoning about both.\nVERDICT: {pick(*answers(messages))}"

    return PairwiseJudge(
        model="gemma-4", family="gemma", instructions="Prefer the correct list.", complete=complete
    )


def prefers_longer(first: str, second: str) -> str:
    if len(first) == len(second):
        return "TIE"
    return "A" if len(first) > len(second) else "B"


def always_first(first: str, second: str) -> str:
    return "A"


def test_a_consistent_verdict_is_kept_in_both_orders() -> None:
    calls: list[Messages] = []
    judge = fake_judge(prefers_longer, calls)

    verdict = judge("Tools: Python, dbt", "python", "python, dbt")

    assert verdict == PairwiseVerdict(preference="b", consistent=True, forward="b", backward="b")
    assert len(calls) == 2
    assert answers(calls[0]) == ("python", "python, dbt")
    assert answers(calls[1]) == ("python, dbt", "python")
    assert "Prefer the correct list." in calls[0][0]["content"]
    assert "Tools: Python, dbt" in calls[0][-1]["content"]


def test_a_verdict_that_follows_position_becomes_an_inconsistent_tie() -> None:
    verdict = fake_judge(always_first)("q", "one", "two")

    assert verdict.preference == "tie"
    assert verdict.consistent is False
    assert (verdict.forward, verdict.backward) == ("a", "b")


def test_a_tie_in_both_orders_is_a_consistent_tie() -> None:
    verdict = fake_judge(prefers_longer)("q", "same", "also")

    assert verdict.preference == "tie"
    assert verdict.consistent is True


def test_the_reference_answer_is_shown_when_given() -> None:
    calls: list[Messages] = []

    fake_judge(prefers_longer, calls)("q", "a", "bb", reference="bb")

    assert "Reference:\nbb" in calls[0][-1]["content"]


def test_an_unreadable_reply_is_an_error() -> None:
    judge = PairwiseJudge("m", "f", "?", lambda model, messages: "both are fine")

    with pytest.raises(JudgeError, match="A, B or TIE"):
        judge("q", "x", "y")


def test_the_judge_may_not_share_a_family_with_a_teacher() -> None:
    cases = [PairwiseCase("1", "q", "a", "bb")]

    with pytest.raises(ValueError, match="teacher"):
        pairwise_compare(fake_judge(prefers_longer), cases, teacher_families={"gemma", "qwen"})


def test_pairwise_compare_counts_wins_ties_and_flips_with_an_exact_interval() -> None:
    cases = (
        [PairwiseCase(f"b{i}", "q", "x", "xx") for i in range(14)]
        + [PairwiseCase(f"a{i}", "q", "xx", "x") for i in range(4)]
        + [PairwiseCase(f"t{i}", "q", "x", "y") for i in range(2)]
    )

    result = pairwise_compare(fake_judge(prefers_longer), cases, teacher_families={"qwen"})

    assert (result.items, result.wins_b, result.wins_a, result.ties) == (20, 14, 4, 2)
    assert result.inconsistent == 0
    assert result.win_rate == pytest.approx(14 / 18)
    assert (result.low, result.high) == pytest.approx(clopper_pearson(14, 18))
    assert result.p_value == pytest.approx(sign_test(14, 4))
    assert result.verdict == "better"
    assert [verdict.preference for verdict in result.verdicts][:1] == ["b"]


def test_position_bias_shows_up_as_an_inconsistency_rate_not_as_wins() -> None:
    cases = [PairwiseCase(str(i), "q", "x", "y") for i in range(10)]

    result = pairwise_compare(fake_judge(always_first), cases, teacher_families=())

    assert result.ties == 10
    assert result.inconsistent == 10
    assert result.inconsistency_rate == 1.0
    assert result.inconsistency_low == pytest.approx(clopper_pearson(10, 10)[0])
    assert result.win_rate is None
    assert result.p_value == 1.0
    assert result.verdict == "no_detectable_difference"


def test_pairwise_compare_needs_cases() -> None:
    with pytest.raises(ValueError, match="at least one"):
        pairwise_compare(fake_judge(prefers_longer), [], teacher_families=())


def test_two_recorded_runs_pair_on_their_shared_cases(tmp_path: Path) -> None:
    history = History(tmp_path / "runs.jsonl")
    bench = Benchmark("tech", tuple(Case(str(i), f"q{i}", "yes") for i in range(3)))
    short = Benchmark("tech", bench.cases[:2])
    before = history.record(short, "v1", run(short.cases, lambda q: "no", exact_match))
    after = history.record(bench, "v2", run(bench.cases, lambda q: "yes", exact_match))

    cases = pairwise_cases(history.get(before), history.get(after))

    assert cases == [
        PairwiseCase("0", "q0", "no", "yes", reference="yes"),
        PairwiseCase("1", "q1", "no", "yes", reference="yes"),
    ]
    other = Benchmark("x", (Case("z", "q", "yes"),))
    lone = history.record(other, "v3", run(other.cases, lambda q: "yes", exact_match))
    with pytest.raises(ValueError, match="no cases in common"):
        pairwise_cases(history.get(before), history.get(lone))


def test_as_a_scorer_an_output_passes_unless_the_reference_answer_beats_it() -> None:
    calls: list[Messages] = []
    metric = parity_metric(fake_judge(prefers_longer, calls), teacher_families={"qwen"})
    cases = [Case("1", "q", "xx"), Case("2", "q", "y"), Case("3", "q", "zzz")]
    outputs = {"q": iter(["x", "yy", "aaa"])}

    result = run(cases, lambda q: next(outputs[q]), metric)

    assert [score.score for score in result.scores] == [0.0, 1.0, 1.0]
    assert result.binary is True
    assert (result.low, result.high) == pytest.approx(clopper_pearson(2, 3))
    assert "Input:" not in calls[0][-1]["content"]
    with pytest.raises(ValueError, match="teacher"):
        parity_metric(fake_judge(prefers_longer), teacher_families={"gemma"})


def test_sign_test_is_exact_and_two_sided() -> None:
    assert sign_test(0, 0) == 1.0
    assert sign_test(5, 0) == pytest.approx(2 / 32)
    assert sign_test(0, 5) == pytest.approx(2 / 32)
