import csv
import json
from collections.abc import Iterable, Iterator, Mapping
from pathlib import Path
from typing import Any

from modelstill.data import TeacherOutput
from modelstill.ingest.records import Record, output_text, parse_json
from modelstill.jsonl import jsonl_lines

BUILDER = "modelstill.ingest.litellm"
EMPTY = (None, "", {}, [])


def read_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))
    content = path.read_text(encoding="utf-8")
    try:
        loaded = json.loads(content)
    except json.JSONDecodeError:
        return [json.loads(line) for line in jsonl_lines(content) if line.strip()]
    if isinstance(loaded, Mapping):
        return list(loaded.get("data", loaded.get("logs", [loaded])))
    return list(loaded)


def _input(row: Mapping[str, Any]) -> Any:
    request = parse_json(row.get("proxy_server_request"))
    if isinstance(request, Mapping):
        for key in ("messages", "input", "prompt"):
            if request.get(key) not in EMPTY:
                return request[key]
    messages = parse_json(row.get("messages"))
    return None if messages in EMPTY else messages


def _error(row: Mapping[str, Any]) -> str:
    metadata = parse_json(row.get("metadata"))
    info = metadata.get("error_information") if isinstance(metadata, Mapping) else None
    if isinstance(info, Mapping) and info.get("error_message"):
        return str(info["error_message"])
    return "failure"


def _output(row: Mapping[str, Any]) -> TeacherOutput | None:
    if row.get("status") == "failure":
        return TeacherOutput(error=_error(row))
    response = parse_json(row.get("response"))
    if response in EMPTY:
        return None
    text = output_text(response)
    return None if text is None else TeacherOutput(text)


def records(rows: Iterable[Mapping[str, Any]], model_field: str = "model") -> Iterator[Record]:
    for row in rows:
        value = _input(row)
        if value is None:
            continue
        model = row.get(model_field)
        yield Record(
            input=value,
            model=str(model) if model else "litellm:unknown",
            output=_output(row),
            keys={"request_id": str(row["request_id"])},
        )
