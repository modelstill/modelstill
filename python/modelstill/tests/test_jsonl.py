import json
from pathlib import Path

from modelstill.jsonl import jsonl_lines, read_jsonl
from modelstill.train import read_chat_jsonl

LINE_SEPARATOR = chr(0x2028)
NEXT_LINE = chr(0x85)


def test_unicode_line_separators_inside_strings_do_not_split_rows() -> None:
    row = json.dumps({"a": f"one{LINE_SEPARATOR}two{NEXT_LINE}three"}, ensure_ascii=False)

    assert jsonl_lines(row + "\n\n") == [row]


def test_windows_line_endings_are_accepted() -> None:
    assert jsonl_lines('{"a": 1}\r\n{"a": 2}\r\n') == ['{"a": 1}', '{"a": 2}']


def test_read_jsonl_parses_every_row(tmp_path: Path) -> None:
    path = tmp_path / "rows.jsonl"
    value = f"x{LINE_SEPARATOR}y"
    path.write_text(json.dumps({"a": value}, ensure_ascii=False) + '\n{"a": 2}\n', encoding="utf-8")

    assert read_jsonl(path) == [{"a": value}, {"a": 2}]


def test_chat_rows_survive_a_line_separator_in_a_posting(tmp_path: Path) -> None:
    row = {
        "messages": [
            {"role": "user", "content": f"EMPLOYER: Fraktion{LINE_SEPARATOR}GRUENE"},
            {"role": "assistant", "content": "{}"},
        ]
    }
    path = tmp_path / "rows.jsonl"
    path.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")

    assert len(read_chat_jsonl(path)) == 1
