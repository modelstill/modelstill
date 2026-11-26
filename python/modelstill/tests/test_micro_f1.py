import pytest

from modelstill.evals import Case, micro_f1, run, set_f1


def cases_with(expected: list[list[str]]) -> list[Case]:
    return [Case(str(i), i, items) for i, items in enumerate(expected)]


def test_pooled_f1_counts_every_item_once() -> None:
    cases = cases_with([["python", "sql"], ["aws"], []])
    outputs = {0: ["python"], 1: ["aws", "gcp"], 2: []}
    result = run(cases, model=lambda i: outputs[i], metric=set_f1)

    score = micro_f1(cases, result)

    assert score.precision == pytest.approx(2 / 3)
    assert score.recall == pytest.approx(2 / 3)
    assert score.f1 == pytest.approx(2 / 3)


def test_answering_nothing_scores_zero_even_when_many_cases_are_empty() -> None:
    cases = cases_with([[], [], [], ["python"]])
    result = run(cases, model=lambda i: [], metric=set_f1)

    assert result.mean == pytest.approx(0.75)
    assert micro_f1(cases, result).f1 == 0.0


def test_pooled_f1_has_a_bootstrap_interval_over_cases() -> None:
    cases = cases_with([["a", "b"]] * 50 + [["c"]] * 50)
    result = run(cases, model=lambda i: ["a", "b"] if i < 50 else [], metric=set_f1)

    score = micro_f1(cases, result, seed=4)

    assert score.low < score.f1 < score.high


def test_failed_cases_count_as_empty_answers() -> None:
    cases = cases_with([["a"], ["b"]])

    def model(i: int) -> list[str]:
        if i == 1:
            raise RuntimeError("down")
        return ["a"]

    score = micro_f1(cases, run(cases, model=model, metric=set_f1))

    assert score.recall == pytest.approx(0.5)
    assert score.precision == 1.0


def test_a_custom_matcher_decides_which_items_count_as_hits() -> None:
    cases = cases_with([["amazon-web-services"]])
    result = run(cases, model=lambda i: ["aws"], metric=set_f1)

    def synonyms(predicted: set[str], truth: set[str]) -> int:
        alias = {"aws": "amazon-web-services"}
        return len({alias.get(item, item) for item in predicted} & truth)

    assert micro_f1(cases, result).f1 == 0.0
    assert micro_f1(cases, result, match=synonyms).f1 == 1.0
