import json
import threading
from pathlib import Path

import pytest

from modelstill.data import (
    DatasetItem,
    DatasetStore,
    LeakageError,
    Provenance,
    TeacherOutput,
    check_no_leakage,
    input_hash,
    label,
    split,
    to_sft_jsonl,
)

PROV = Provenance(source="fixture", keys={"id": "p1"}, builder="test-1")


def item(text: str, **keys: str) -> DatasetItem:
    return DatasetItem.create({"text": text}, Provenance("fixture", keys or {"id": text}, "test-1"))


def same(a: str, b: str) -> bool:
    return a.strip().lower() == b.strip().lower()


def test_input_hash_is_sha256_of_canonical_json() -> None:
    assert input_hash({"b": 1, "a": "é"}) == input_hash({"a": "é", "b": 1})
    assert input_hash({"a": 1}) != input_hash({"a": 2})
    assert len(input_hash({"a": 1})) == 64


def test_item_carries_its_input_hash_and_starts_unreviewed() -> None:
    created = DatasetItem.create({"text": "x"}, PROV)

    assert created.input_hash == input_hash({"text": "x"})
    assert created.review_state == "none"
    assert created.outputs == {}
    assert created.agreement is None
    assert created.final_output is None


def test_item_round_trips_through_json() -> None:
    created = DatasetItem.create(
        {"text": "x"}, PROV, outputs={"production": TeacherOutput(output="X")}
    )

    assert DatasetItem.from_json(json.loads(json.dumps(created.to_json()))) == created


def test_item_from_json_rejects_a_tampered_input() -> None:
    row = DatasetItem.create({"text": "x"}, PROV).to_json()
    row["input"] = {"text": "y"}

    with pytest.raises(ValueError, match="input_hash"):
        DatasetItem.from_json(row)


def test_unknown_review_state_is_rejected() -> None:
    row = DatasetItem.create({"text": "x"}, PROV).to_json()
    row["review_state"] = "maybe"

    with pytest.raises(ValueError, match="review_state"):
        DatasetItem.from_json(row)


def test_store_deduplicates_by_input_hash(tmp_path: Path) -> None:
    store = DatasetStore(tmp_path / "data.jsonl")

    assert store.add([item("a"), item("b"), item("a", id="other")]) == 2
    assert store.add([item("b"), item("c")]) == 1
    assert [i.input["text"] for i in store.load()] == ["a", "b", "c"]


def test_store_is_append_only_and_latest_record_wins(tmp_path: Path) -> None:
    path = tmp_path / "data.jsonl"
    store = DatasetStore(path)
    store.add([item("a"), item("b")])
    first_lines = path.read_text().splitlines()
    labelled = [
        i.with_outputs({"t": TeacherOutput(output="A")}) if i.input["text"] == "a" else i
        for i in store.load()
    ]

    assert store.save(labelled) == 1
    assert path.read_text().splitlines()[:2] == first_lines
    loaded = store.load()
    assert loaded[0].outputs == {"t": TeacherOutput(output="A")}
    assert store.save(loaded) == 0


def test_store_version_is_a_content_hash(tmp_path: Path) -> None:
    one, two = DatasetStore(tmp_path / "1.jsonl"), DatasetStore(tmp_path / "2.jsonl")
    one.add([item("a"), item("b")])
    two.add([item("a"), item("b")])

    assert one.version() == two.version()
    two.add([item("c")])
    assert one.version() != two.version()


def test_missing_store_loads_empty(tmp_path: Path) -> None:
    assert DatasetStore(tmp_path / "none.jsonl").load() == []


def test_label_agreement_sets_final_output() -> None:
    [result] = label([item("x")], {"a": lambda i: "Yes", "b": lambda i: "yes "}, same).items

    assert result.outputs["a"].output == "Yes"
    assert result.outputs["b"].output == "yes "
    assert result.agreement is True
    assert result.final_output == "Yes"
    assert result.review_state == "none"


def test_label_disagreement_queues_for_review() -> None:
    [result] = label([item("x")], {"a": lambda i: "yes", "b": lambda i: "no"}, same).items

    assert result.agreement is False
    assert result.final_output is None
    assert result.review_state == "queued"


def test_label_uses_outputs_already_recorded() -> None:
    seeded = item("x").with_outputs({"production": TeacherOutput(output="yes")})
    calls: list[str] = []

    def teacher(value: object) -> str:
        calls.append("b")
        return "YES"

    report = label([seeded], {"b": teacher}, same, prefer="b")

    assert calls == ["b"]
    assert report.items[0].agreement is True
    assert report.items[0].final_output == "YES"


def test_label_does_not_call_a_teacher_that_already_answered() -> None:
    seeded = item("x").with_outputs({"a": TeacherOutput(output="yes")})
    report = label([seeded], {"a": lambda i: pytest.fail("called"), "b": lambda i: "yes"}, same)

    assert report.calls == 1


def test_label_records_failures_without_crashing_the_batch() -> None:
    def broken(value: object) -> str:
        raise RuntimeError("provider down")

    report = label([item("x"), item("y")], {"a": lambda i: "yes", "b": broken}, same)

    assert report.failed == 2
    for result in report.items:
        assert result.outputs["b"].output is None
        assert "provider down" in (result.outputs["b"].error or "")
        assert result.agreement is None
        assert result.review_state == "none"


def test_label_retries_a_teacher_that_failed_before() -> None:
    seeded = item("x").with_outputs({"a": TeacherOutput(error="timeout")})
    report = label([seeded], {"a": lambda i: "yes", "b": lambda i: "yes"}, same)

    assert report.calls == 2
    assert report.items[0].agreement is True


def test_label_never_makes_more_than_max_calls() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def teacher(value: object) -> str:
        with lock:
            calls.append(1)
        return "yes"

    items = [item(str(n)) for n in range(10)]
    report = label(items, {"a": teacher, "b": teacher}, same, max_calls=5, workers=4)

    assert len(calls) == 5
    assert report.calls == 5
    assert report.skipped == 15
    assert len(report.items) == 10
    assert sum(1 for i in report.items if i.agreement is True) == 2


def test_label_keeps_item_order_with_many_workers() -> None:
    items = [item(str(n)) for n in range(50)]
    report = label(items, {"a": lambda i: "x", "b": lambda i: "x"}, same, workers=8)

    assert [i.input_hash for i in report.items] == [i.input_hash for i in items]
    assert report.agreed == 50
    assert report.disagreed == 0


def test_label_does_not_relabel_a_reviewed_item() -> None:
    reviewed = item("x").with_review("corrected", final_output="fixed")
    report = label([reviewed], {"a": lambda i: "yes", "b": lambda i: "no"}, same)

    assert report.calls == 0
    assert report.items[0].final_output == "fixed"
    assert report.items[0].review_state == "corrected"


def test_split_is_deterministic_and_covers_every_item() -> None:
    items = [item(str(n)) for n in range(2000)]
    fractions = {"train": 0.8, "val": 0.1, "calib": 0.1}

    first = split(items, fractions, seed="s1")
    again = split(list(reversed(items)), fractions, seed="s1")

    assert first.assignments == again.assignments
    assert first.version == again.version
    assert set(first.assignments) == {i.input_hash for i in items}
    counts = first.counts()
    assert 1500 < counts["train"] < 1700
    assert 120 < counts["val"] < 280


def test_split_assignment_is_stable_when_items_are_added() -> None:
    items = [item(str(n)) for n in range(200)]
    fractions = {"train": 0.8, "val": 0.2}
    before = split(items, fractions, seed="s1")
    after = split([*items, item("new")], fractions, seed="s1")

    assert all(after.assignments[h] == name for h, name in before.assignments.items())


def test_split_seed_changes_assignment_and_version() -> None:
    items = [item(str(n)) for n in range(200)]
    fractions = {"train": 0.5, "val": 0.5}

    assert split(items, fractions, seed="a").version != split(items, fractions, seed="b").version


def test_split_fractions_must_sum_to_one() -> None:
    with pytest.raises(ValueError, match="sum"):
        split([item("a")], {"train": 0.8, "val": 0.1}, seed="s")


def test_split_excludes_by_input_hash_or_provenance_key() -> None:
    gold_by_hash, gold_by_id, other = item("g1"), item("g2", id="gold-2"), item("ok")
    result = split(
        [gold_by_hash, gold_by_id, other],
        {"train": 1.0},
        seed="s",
        exclude={gold_by_hash.input_hash, "gold-2"},
    )

    assert result.assignments == {other.input_hash: "train"}
    assert result.excluded == 2


def test_leakage_check_raises_when_an_excluded_item_is_in_train() -> None:
    a, b = item("a"), item("b")
    result = split([a, b], {"train": 1.0}, seed="s")

    with pytest.raises(LeakageError, match="1"):
        check_no_leakage(result, [a, b], exclude={b.input_hash})
    check_no_leakage(result, [a, b], exclude={"unrelated"})


def test_split_items_in_returns_the_named_part() -> None:
    items = [item(str(n)) for n in range(100)]
    result = split(items, {"train": 0.5, "val": 0.5}, seed="s")

    train = result.items_in("train", items)
    assert len(train) == result.counts()["train"]
    assert all(result.assignments[i.input_hash] == "train" for i in train)


def test_split_round_trips_through_json() -> None:
    items = [item(str(n)) for n in range(20)]
    result = split(items, {"train": 0.5, "val": 0.5}, seed="s", exclude={"x"})

    assert type(result).from_json(json.loads(json.dumps(result.to_json()))) == result


def test_sft_rows_are_chat_messages_for_settled_items_only(tmp_path: Path) -> None:
    agreed = label([item("a")], {"x": lambda i: "A", "y": lambda i: "a"}, same).items[0]
    queued = label([item("b")], {"x": lambda i: "B", "y": lambda i: "c"}, same).items[0]
    corrected = queued.with_review("corrected", final_output="C")
    unlabelled = item("d")
    out = tmp_path / "sft.jsonl"

    written = to_sft_jsonl(
        [agreed, queued, corrected, unlabelled],
        out,
        system_prompt="SYS",
        render_input=lambda value: f"TEXT: {value['text']}",
    )

    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert written == 2
    assert rows == [
        {
            "messages": [
                {"role": "system", "content": "SYS"},
                {"role": "user", "content": "TEXT: a"},
                {"role": "assistant", "content": "A"},
            ]
        },
        {
            "messages": [
                {"role": "system", "content": "SYS"},
                {"role": "user", "content": "TEXT: b"},
                {"role": "assistant", "content": "C"},
            ]
        },
    ]
