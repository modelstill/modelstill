import csv
import json
from pathlib import Path
from typing import Any

from modelstill.data import TeacherOutput
from modelstill.ingest.litellm_logs import read_rows, records

MESSAGES = [{"role": "user", "content": "Tools in: Python, Snowflake"}]


def row(number: int, **extra: Any) -> dict[str, Any]:
    return {
        "request_id": f"req-{number}",
        "call_type": "acompletion",
        "model": "gpt-5-mini",
        "model_group": "technographics",
        "status": "success",
        "messages": "{}",
        "proxy_server_request": json.dumps({"model": "technographics", "messages": MESSAGES}),
        "response": json.dumps(
            {"choices": [{"message": {"role": "assistant", "content": f"answer {number}"}}]}
        ),
        "metadata": "{}",
        **extra,
    }


def test_reads_csv_json_and_json_lines_exports(tmp_path: Path) -> None:
    rows = [row(1), row(2)]
    as_csv = tmp_path / "logs.csv"
    with as_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    as_json = tmp_path / "logs.json"
    as_json.write_text(json.dumps(rows))
    wrapped = tmp_path / "wrapped.json"
    wrapped.write_text(json.dumps({"data": rows}))
    as_lines = tmp_path / "logs.jsonl"
    as_lines.write_text("".join(json.dumps(r) + "\n" for r in rows))

    for path in (as_csv, as_json, wrapped, as_lines):
        assert [r["request_id"] for r in read_rows(path)] == ["req-1", "req-2"], path


def test_rows_become_records_keyed_by_the_model_that_answered() -> None:
    [record] = records([row(1)])

    assert record.input == MESSAGES
    assert record.model == "gpt-5-mini"
    assert record.output == TeacherOutput("answer 1")
    assert record.keys == {"request_id": "req-1"}


def test_the_model_field_can_be_the_public_model_group() -> None:
    [record] = records([row(1)], model_field="model_group")

    assert record.model == "technographics"


def test_messages_column_is_used_when_the_request_body_is_missing() -> None:
    [record] = records([row(1, proxy_server_request="{}", messages=json.dumps(MESSAGES))])

    assert record.input == MESSAGES


def test_failed_calls_carry_the_error_and_rows_without_prompts_are_skipped() -> None:
    failed = row(
        2,
        status="failure",
        response="{}",
        metadata=json.dumps({"error_information": {"error_message": "RateLimitError"}}),
    )
    redacted = row(3, proxy_server_request="{}")

    [record] = records([failed, redacted])

    assert record.output == TeacherOutput(error="RateLimitError")
