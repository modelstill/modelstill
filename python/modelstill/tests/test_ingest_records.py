from pathlib import Path

from modelstill.data import DatasetStore, TeacherOutput
from modelstill.ingest.records import (
    Record,
    lookup,
    output_text,
    parse_json,
    to_items,
    write_dataset,
)

MESSAGES = [{"role": "user", "content": "Which tools does this job need?"}]


def test_parse_json_loads_json_text_and_leaves_other_values() -> None:
    assert parse_json('{"a": 1}') == {"a": 1}
    assert parse_json("[1, 2]") == [1, 2]
    assert parse_json("plain words") == "plain words"
    assert parse_json('{"broken": ') == '{"broken": '
    assert parse_json({"a": 1}) == {"a": 1}


def test_output_text_reads_the_common_answer_shapes() -> None:
    assert output_text(None) is None
    assert output_text("python, sql") == "python, sql"
    assert output_text({"role": "assistant", "content": "ok"}) == "ok"
    assert output_text({"choices": [{"message": {"role": "assistant", "content": "a"}}]}) == "a"
    assert output_text({"choices": [{"text": "b"}]}) == "b"
    assert (
        output_text([{"role": "user", "content": "q"}, {"role": "assistant", "content": "c"}])
        == "c"
    )
    assert (
        output_text({"content": [{"type": "text", "text": "x"}, {"type": "text", "text": "y"}]})
        == "xy"
    )
    assert output_text({"type": "text", "text": "z"}) == "z"
    assert output_text({"text": "z", "label": 1}) == '{"label":1,"text":"z"}'
    assert output_text({"skills": ["sql"]}) == '{"skills":["sql"]}'
    assert output_text(3) == "3"


def test_lookup_follows_dotted_paths() -> None:
    row = {"request": {"body": {"messages": MESSAGES}}, "flat.key": 1}

    assert lookup(row, "request.body.messages") == MESSAGES
    assert lookup(row, "request.missing") is None
    assert lookup(row, "flat.key") == 1


def test_records_with_the_same_input_become_one_item_with_outputs_by_model() -> None:
    records = [
        Record(MESSAGES, "gpt-5-mini", TeacherOutput("sql"), {"trace_id": "t1"}),
        Record(MESSAGES, "qwen3-4b", TeacherOutput("python"), {"trace_id": "t2"}),
        Record("other", "gpt-5-mini", TeacherOutput(error="timeout"), {"trace_id": "t3"}),
        Record("bare", None, None, {"trace_id": "t4"}),
    ]

    items = to_items(records, source="langfuse", builder="modelstill.ingest.langfuse")

    assert len(items) == 3
    first = items[0]
    assert first.input == MESSAGES
    assert first.provenance.source == "langfuse"
    assert first.provenance.keys == {"trace_id": "t1"}
    assert dict(first.outputs) == {
        "gpt-5-mini": TeacherOutput("sql"),
        "qwen3-4b": TeacherOutput("python"),
    }
    assert items[1].outputs["gpt-5-mini"].error == "timeout"
    assert dict(items[2].outputs) == {}


def test_write_dataset_merges_new_outputs_into_items_already_stored(tmp_path: Path) -> None:
    path = tmp_path / "dataset.jsonl"
    first = to_items([Record(MESSAGES, "a", TeacherOutput("1"), {"id": "x"})], "s", "b")
    second = to_items(
        [
            Record(MESSAGES, "b", TeacherOutput("2"), {"id": "y"}),
            Record("new", "a", TeacherOutput("3"), {"id": "z"}),
        ],
        "s",
        "b",
    )

    assert write_dataset(first, path) == 1
    assert write_dataset(second, path) == 2
    assert write_dataset(second, path) == 0

    stored = {item.input_hash: item for item in DatasetStore(path).load()}
    merged = stored[first[0].input_hash]
    assert set(merged.outputs) == {"a", "b"}
    assert merged.provenance.keys == {"id": "x"}
    assert len(stored) == 2
