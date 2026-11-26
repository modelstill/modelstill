import json
from pathlib import Path
from typing import Any

__all__ = ["jsonl_lines", "read_jsonl"]


def jsonl_lines(text: str) -> list[str]:
    return [line.removesuffix("\r") for line in text.split("\n") if line.strip()]


def read_jsonl(path: Path) -> list[Any]:
    return [json.loads(line) for line in jsonl_lines(path.read_text(encoding="utf-8"))]
