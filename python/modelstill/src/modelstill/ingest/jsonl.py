import json
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from modelstill.data import TeacherOutput
from modelstill.ingest.records import Record, lookup, output_text

BUILDER = "modelstill.ingest.jsonl"


@dataclass(frozen=True)
class FieldMap:
    input: str
    output: str | None = None
    model: str | None = None
    model_name: str | None = None
    id: str | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        named = (self.model is not None) + (self.model_name is not None)
        if named > 1 or (self.output is not None and named == 0):
            raise ValueError("name the model with either a model field or a fixed model name")


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _input(row: Mapping[str, Any], fields: str) -> Any:
    names = [name.strip() for name in fields.split(",")]
    if len(names) == 1:
        return lookup(row, names[0])
    values = {name.rsplit(".", 1)[-1]: lookup(row, name) for name in names}
    return None if all(value is None for value in values.values()) else values


def _output(row: Mapping[str, Any], mapping: FieldMap) -> TeacherOutput | None:
    error = lookup(row, mapping.error) if mapping.error else None
    if error:
        return TeacherOutput(error=str(error))
    text = output_text(lookup(row, mapping.output)) if mapping.output else None
    return None if text is None else TeacherOutput(text)


def records(rows: Iterable[Mapping[str, Any]], mapping: FieldMap) -> Iterator[Record]:
    for number, row in enumerate(rows, start=1):
        value = _input(row, mapping.input)
        if value is None:
            continue
        model = lookup(row, mapping.model) if mapping.model else mapping.model_name
        identity = lookup(row, mapping.id) if mapping.id else None
        yield Record(
            input=value,
            model=None if model is None else str(model),
            output=_output(row, mapping),
            keys={"id": str(identity)} if identity is not None else {"line": str(number)},
        )
