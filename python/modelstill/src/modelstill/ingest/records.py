import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from modelstill.data import DatasetItem, DatasetStore, Provenance, TeacherOutput


@dataclass(frozen=True)
class Record:
    input: Any
    model: str | None
    output: TeacherOutput | None
    keys: Mapping[str, str]


def parse_json(value: Any) -> Any:
    if not isinstance(value, str) or value.lstrip()[:1] not in ("{", "["):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _parts_text(parts: Sequence[Any]) -> str | None:
    texts = [
        part.get("text", part.get("content"))
        for part in parts
        if isinstance(part, Mapping) and part.get("type", "text") == "text"
    ]
    if not texts or not all(isinstance(text, str) for text in texts):
        return None
    return "".join(texts)


def _mapping_text(value: Mapping[str, Any]) -> str | None:
    choices = value.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], Mapping):
        first = choices[0]
        return output_text(first.get("message", first.get("text")))
    for key in ("content", "parts"):
        found = value.get(key)
        if isinstance(found, str):
            return found
        if isinstance(found, list) and (text := _parts_text(found)) is not None:
            return text
    if isinstance(value.get("text"), str) and set(value) <= {"type", "text"}:
        return value["text"]
    return None


def output_text(value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        text = _mapping_text(value)
        return text if text is not None else _canonical(value)
    if isinstance(value, list) and value and all(isinstance(m, Mapping) for m in value):
        if all("role" in message for message in value):
            return output_text(value[-1])
    return _canonical(value)


def lookup(row: Mapping[str, Any], path: str) -> Any:
    if path in row:
        return row[path]
    found: Any = row
    for part in path.split("."):
        if not isinstance(found, Mapping) or part not in found:
            return None
        found = found[part]
    return found


def to_items(records: Iterable[Record], source: str, builder: str) -> list[DatasetItem]:
    merged: dict[str, DatasetItem] = {}
    for record in records:
        outputs = (
            {} if record.model is None or record.output is None else {record.model: record.output}
        )
        item = DatasetItem.create(record.input, Provenance(source, dict(record.keys), builder))
        known = merged.get(item.input_hash)
        merged[item.input_hash] = (known or item).with_outputs(outputs)
    return list(merged.values())


def write_dataset(items: Sequence[DatasetItem], path: Path) -> int:
    store = DatasetStore(path)
    stored = {item.input_hash: item for item in store.load()}
    combined = [
        stored[item.input_hash].with_outputs(item.outputs) if item.input_hash in stored else item
        for item in items
    ]
    return store.save(combined)
