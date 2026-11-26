import json
from pathlib import Path

from modelstill.data import DatasetItem, Provenance, TeacherOutput, split, to_sft_jsonl


def recorded(text: str, answer: str | None, company: str = "acme") -> DatasetItem:
    outputs = {"production": TeacherOutput(output=answer)} if answer is not None else {}
    return DatasetItem.create(
        {"text": text, "company": company}, Provenance("fixture", {"id": text}, "test-1"), outputs
    )


def rows(path: Path) -> list[dict[str, list[dict[str, str]]]]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_sft_can_target_a_recorded_teacher_for_every_item(tmp_path: Path) -> None:
    items = [recorded("a", '{"x": 1}'), recorded("b", '{"x": 2}'), recorded("c", None)]
    path = tmp_path / "sft.jsonl"

    written = to_sft_jsonl(items, path, "SYS", lambda value: value["text"], target="production")

    assert written == 2
    assert [row["messages"][2]["content"] for row in rows(path)] == ['{"x": 1}', '{"x": 2}']


def test_sft_drops_recorded_answers_that_break_the_contract(tmp_path: Path) -> None:
    items = [recorded("a", '{"x": 1}'), recorded("b", "not json")]
    path = tmp_path / "sft.jsonl"

    def valid(answer: str) -> bool:
        return answer.startswith("{")

    written = to_sft_jsonl(
        items, path, "SYS", lambda value: value["text"], target="production", keep=valid
    )

    assert written == 1


def test_items_of_one_group_land_in_the_same_part() -> None:
    items = [recorded(f"posting {n}", "{}", company=f"co{n % 7}") for n in range(200)]

    parts = split(
        items,
        {"train": 0.6, "val": 0.2, "calib": 0.2},
        seed="s",
        group=lambda found: found.input["company"],
    )

    by_company: dict[str, set[str]] = {}
    for found in items:
        by_company.setdefault(found.input["company"], set()).add(
            parts.assignments[found.input_hash]
        )
    assert all(len(assigned) == 1 for assigned in by_company.values())
    assert len({part for assigned in by_company.values() for part in assigned}) > 1
