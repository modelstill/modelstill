import json
from pathlib import Path

import pytest

from modelstill.data import TeacherOutput
from modelstill.ingest.jsonl import FieldMap, read_jsonl, records

ROWS = [
    {"id": 7, "req": {"text": "Python", "lang": "en"}, "answer": "python", "llm": "gpt-5-mini"},
    {"id": 8, "req": {"text": "SQL", "lang": "en"}, "answer": None, "err": "timeout", "llm": "m"},
    {"id": 9, "answer": "orphan"},
]


def test_reads_json_lines_and_skips_blank_lines(tmp_path: Path) -> None:
    path = tmp_path / "rows.jsonl"
    path.write_text(json.dumps(ROWS[0]) + "\n\n" + json.dumps(ROWS[1]) + "\n")

    assert [row["id"] for row in read_jsonl(path)] == [7, 8]


def test_maps_dotted_fields_onto_records() -> None:
    mapping = FieldMap(input="req.text", output="answer", model="llm", id="id", error="err")

    first, second = records(ROWS, mapping)

    assert first.input == "Python"
    assert first.model == "gpt-5-mini"
    assert first.output == TeacherOutput("python")
    assert first.keys == {"id": "7"}
    assert second.output == TeacherOutput(error="timeout")


def test_several_input_fields_become_one_object_and_a_fixed_model_name_works() -> None:
    mapping = FieldMap(input="req.text,req.lang", output="answer", model_name="prod")

    first, _ = records(ROWS, mapping)

    assert first.input == {"text": "Python", "lang": "en"}
    assert first.model == "prod"
    assert first.keys == {"line": "1"}


def test_a_field_map_needs_exactly_one_way_to_name_the_model() -> None:
    with pytest.raises(ValueError, match="model"):
        FieldMap(input="req", output="answer", model="llm", model_name="x")
    with pytest.raises(ValueError, match="model"):
        FieldMap(input="req", output="answer")
    assert FieldMap(input="req").output is None
