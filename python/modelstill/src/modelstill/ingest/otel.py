import json
import re
from collections.abc import Iterable, Iterator, Mapping
from pathlib import Path
from typing import Any

from modelstill.data import TeacherOutput
from modelstill.ingest.records import Record, output_text, parse_json
from modelstill.jsonl import jsonl_lines

BUILDER = "modelstill.ingest.otel"
INDEXED = re.compile(r"^gen_ai\.(prompt|completion)\.(\d+)\.(\w+)$")
ERROR_CODES = (2, "2", "STATUS_CODE_ERROR")


def any_value(value: Mapping[str, Any]) -> Any:
    if "stringValue" in value:
        return value["stringValue"]
    if "intValue" in value:
        return int(value["intValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "boolValue" in value:
        return bool(value["boolValue"])
    if "bytesValue" in value:
        return value["bytesValue"]
    if "arrayValue" in value:
        return [any_value(item) for item in value["arrayValue"].get("values", [])]
    if "kvlistValue" in value:
        return attributes(value["kvlistValue"].get("values", []))
    return None


def attributes(pairs: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    return {pair["key"]: any_value(pair.get("value") or {}) for pair in pairs}


def _exports(path: Path) -> list[Any]:
    content = path.read_text()
    try:
        return [json.loads(content)]
    except json.JSONDecodeError:
        return [json.loads(line) for line in jsonl_lines(content) if line.strip()]


def read_spans(path: Path) -> Iterator[dict[str, Any]]:
    for export in _exports(path):
        for resource in export.get("resourceSpans", []):
            scopes = resource.get("scopeSpans", resource.get("instrumentationLibrarySpans", []))
            for scope in scopes:
                yield from scope.get("spans", [])


def _parts_message(role: str, parts: list[Any]) -> dict[str, Any]:
    if all(isinstance(p, Mapping) and p.get("type") == "text" for p in parts):
        return {"role": role, "content": "".join(str(p.get("content", "")) for p in parts)}
    return {"role": role, "parts": parts}


def _message(message: Any) -> Any:
    if isinstance(message, Mapping) and isinstance(message.get("parts"), list):
        return _parts_message(str(message.get("role")), message["parts"])
    return message


def _messages(value: Any) -> list[Any] | None:
    loaded = parse_json(value)
    if isinstance(loaded, list):
        return [_message(message) for message in loaded]
    if isinstance(loaded, str):
        return [{"role": "user", "content": loaded}]
    return None


def _indexed(attrs: Mapping[str, Any], kind: str) -> list[dict[str, Any]]:
    found: dict[int, dict[str, Any]] = {}
    for key, value in attrs.items():
        match = INDEXED.match(key)
        if match and match.group(1) == kind:
            found.setdefault(int(match.group(2)), {})[match.group(3)] = value
    return [found[index] for index in sorted(found)]


def _event(span: Mapping[str, Any], name: str, key: str) -> Any:
    for event in span.get("events", []):
        if event.get("name") == name:
            return attributes(event.get("attributes", [])).get(key)
    return None


def _system(attrs: Mapping[str, Any]) -> list[Any]:
    parts = parse_json(attrs.get("gen_ai.system_instructions"))
    if isinstance(parts, list):
        return [_parts_message("system", parts)]
    if isinstance(parts, str):
        return [{"role": "system", "content": parts}]
    return []


def _input(span: Mapping[str, Any], attrs: Mapping[str, Any]) -> list[Any] | None:
    messages = _messages(attrs.get("gen_ai.input.messages"))
    if messages is not None:
        return [*_system(attrs), *messages]
    indexed = _indexed(attrs, "prompt")
    if indexed:
        return indexed
    return _messages(_event(span, "gen_ai.content.prompt", "gen_ai.prompt"))


def _answer(span: Mapping[str, Any], attrs: Mapping[str, Any]) -> str | None:
    messages = _messages(attrs.get("gen_ai.output.messages"))
    if messages:
        return output_text(messages[0])
    indexed = _indexed(attrs, "completion")
    if indexed:
        return output_text(indexed[0])
    return output_text(parse_json(_event(span, "gen_ai.content.completion", "gen_ai.completion")))


def _output(span: Mapping[str, Any], attrs: Mapping[str, Any]) -> TeacherOutput | None:
    status = span.get("status") or {}
    if status.get("code") in ERROR_CODES:
        return TeacherOutput(error=status.get("message") or "error")
    answer = _answer(span, attrs)
    return None if answer is None else TeacherOutput(answer)


def records(spans: Iterable[Mapping[str, Any]]) -> Iterator[Record]:
    for span in spans:
        attrs = attributes(span.get("attributes", []))
        if not any(key.startswith("gen_ai.") for key in attrs):
            continue
        value = _input(span, attrs)
        if value is None:
            continue
        model = attrs.get("gen_ai.response.model") or attrs.get("gen_ai.request.model")
        yield Record(
            input=value,
            model=str(model) if model else f"otel:{span.get('name', 'span')}",
            output=_output(span, attrs),
            keys={"trace_id": str(span.get("traceId")), "span_id": str(span.get("spanId"))},
        )
