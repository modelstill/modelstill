import json
from pathlib import Path
from typing import Any

from modelstill.data import TeacherOutput
from modelstill.ingest.otel import any_value, read_spans, records


def text(value: str) -> dict[str, Any]:
    return {"stringValue": value}


def attr(key: str, value: dict[str, Any]) -> dict[str, Any]:
    return {"key": key, "value": value}


CURRENT = {
    "traceId": "5b8efff798038103d269b633813fc60c",
    "spanId": "eee19b7ec3c1b174",
    "name": "chat gpt-5-mini",
    "kind": 3,
    "attributes": [
        attr("gen_ai.operation.name", text("chat")),
        attr("gen_ai.provider.name", text("openai")),
        attr("gen_ai.request.model", text("gpt-5-mini")),
        attr("gen_ai.response.model", text("gpt-5-mini-2026-08-07")),
        attr("gen_ai.usage.input_tokens", {"intValue": "42"}),
        attr(
            "gen_ai.system_instructions",
            text(json.dumps([{"type": "text", "content": "Answer briefly."}])),
        ),
        attr(
            "gen_ai.input.messages",
            text(json.dumps([{"role": "user", "parts": [{"type": "text", "content": "Tools?"}]}])),
        ),
        attr(
            "gen_ai.output.messages",
            text(
                json.dumps(
                    [
                        {
                            "role": "assistant",
                            "parts": [{"type": "text", "content": "python, dbt"}],
                            "finish_reason": "stop",
                        }
                    ]
                )
            ),
        ),
    ],
    "status": {},
}

LEGACY = {
    "traceId": "aa",
    "spanId": "bb",
    "name": "openai.chat",
    "attributes": [
        attr("gen_ai.system", text("openai")),
        attr("gen_ai.request.model", text("qwen3-4b")),
        attr("gen_ai.prompt.0.role", text("system")),
        attr("gen_ai.prompt.0.content", text("Be brief.")),
        attr("gen_ai.prompt.1.role", text("user")),
        attr("gen_ai.prompt.1.content", text("Tools?")),
        attr("gen_ai.completion.0.role", text("assistant")),
        attr("gen_ai.completion.0.content", text("python")),
    ],
}

EVENTS = {
    "traceId": "cc",
    "spanId": "dd",
    "name": "chat",
    "attributes": [attr("gen_ai.request.model", text("gpt-4o"))],
    "events": [
        {
            "name": "gen_ai.content.prompt",
            "attributes": [
                attr("gen_ai.prompt", text(json.dumps([{"role": "user", "content": "Hi"}])))
            ],
        },
        {
            "name": "gen_ai.content.completion",
            "attributes": [attr("gen_ai.completion", text("Hello"))],
        },
    ],
}

FAILED = {
    "traceId": "ee",
    "spanId": "ff",
    "name": "chat",
    "attributes": [
        attr("gen_ai.operation.name", text("chat")),
        attr("gen_ai.request.model", text("gpt-5-mini")),
        attr("gen_ai.input.messages", text(json.dumps([{"role": "user", "content": "Tools?"}]))),
    ],
    "status": {"code": 2, "message": "upstream timeout"},
}

HTTP = {
    "traceId": "11",
    "spanId": "22",
    "name": "GET /",
    "attributes": [attr("http.method", text("GET"))],
}


def export(*spans: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": [attr("service.name", text("api"))]},
                "scopeSpans": [{"scope": {"name": "genai"}, "spans": list(spans)}],
            }
        ]
    }


def test_any_value_converts_every_otlp_value_kind() -> None:
    assert any_value({"stringValue": "a"}) == "a"
    assert any_value({"intValue": "7"}) == 7
    assert any_value({"doubleValue": 0.5}) == 0.5
    assert any_value({"boolValue": True}) is True
    assert any_value({"arrayValue": {"values": [{"intValue": 1}, {"stringValue": "b"}]}}) == [
        1,
        "b",
    ]
    assert any_value({"kvlistValue": {"values": [attr("k", {"stringValue": "v"})]}}) == {"k": "v"}
    assert any_value({}) is None


def test_reads_a_single_export_and_a_json_lines_file(tmp_path: Path) -> None:
    single = tmp_path / "one.json"
    single.write_text(json.dumps(export(CURRENT, HTTP)))
    lines = tmp_path / "lines.jsonl"
    lines.write_text(json.dumps(export(CURRENT)) + "\n\n" + json.dumps(export(LEGACY)) + "\n")

    assert [span["spanId"] for span in read_spans(single)] == ["eee19b7ec3c1b174", "22"]
    assert [span["spanId"] for span in read_spans(lines)] == ["eee19b7ec3c1b174", "bb"]


def test_current_conventions_give_chat_messages_and_the_answering_model() -> None:
    [record] = records([CURRENT, HTTP])

    assert record.input == [
        {"role": "system", "content": "Answer briefly."},
        {"role": "user", "content": "Tools?"},
    ]
    assert record.model == "gpt-5-mini-2026-08-07"
    assert record.output == TeacherOutput("python, dbt")
    assert record.keys == {
        "trace_id": "5b8efff798038103d269b633813fc60c",
        "span_id": "eee19b7ec3c1b174",
    }


def test_indexed_prompt_attributes_and_content_events_are_read() -> None:
    legacy, events = records([LEGACY, EVENTS])

    assert legacy.input == [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "Tools?"},
    ]
    assert legacy.model == "qwen3-4b"
    assert legacy.output == TeacherOutput("python")
    assert events.input == [{"role": "user", "content": "Hi"}]
    assert events.output == TeacherOutput("Hello")


def test_error_status_becomes_a_failed_output() -> None:
    [record] = records([FAILED])

    assert record.output == TeacherOutput(error="upstream timeout")


def test_tool_call_parts_are_kept_as_they_are() -> None:
    parts = [{"type": "tool_call", "id": "c1", "name": "lookup", "arguments": {"q": "x"}}]
    span = {
        **CURRENT,
        "attributes": [
            attr("gen_ai.request.model", text("m")),
            attr(
                "gen_ai.input.messages", text(json.dumps([{"role": "assistant", "parts": parts}]))
            ),
        ],
    }

    [record] = records([span])

    assert record.input == [{"role": "assistant", "parts": parts}]
    assert record.output is None
