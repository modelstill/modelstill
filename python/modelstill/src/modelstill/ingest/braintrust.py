import gzip
import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Iterator, Mapping, Sequence
from pathlib import Path
from statistics import fmean
from typing import IO, Any, Literal

from modelstill.client import Opener
from modelstill.data import TeacherOutput, input_hash
from modelstill.ingest.records import Record, output_text
from modelstill.ingest.runs import ImportedCase, ImportedRun

BUILDER = "modelstill.ingest.braintrust"
SOURCE = "braintrust"
DEFAULT_API_URL = "https://api.braintrust.dev"
Kind = Literal["project_logs", "dataset", "experiment"]
Row = Mapping[str, Any]


class BraintrustError(Exception):
    pass


def _open(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class BraintrustReader:
    def __init__(
        self,
        api_key: str,
        api_url: str = DEFAULT_API_URL,
        timeout: float = 60.0,
        opener: Opener = _open,
    ) -> None:
        self._base = api_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout
        self._opener = opener

    def _post(self, path: str, body: Mapping[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self._base}{path}",
            data=json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with self._opener(request, self._timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            raise BraintrustError(f"{error.code}: {detail}") from error

    def events(self, kind: Kind, object_id: str, page_size: int = 100) -> Iterator[dict[str, Any]]:
        path = f"/v1/{kind}/{urllib.parse.quote(object_id, safe='')}/fetch"
        seen: set[str] = set()
        cursor: str | None = None
        while True:
            body: dict[str, Any] = {"limit": page_size}
            if cursor:
                body["cursor"] = cursor
            page = self._post(path, body)
            events = page.get("events") or []
            for event in events:
                if event["id"] not in seen:
                    seen.add(event["id"])
                    yield event
            cursor = page.get("cursor")
            if not events or not cursor:
                return


def _text(path: Path) -> str:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8")


def _parsed(text: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    if isinstance(data, list):
        return data
    for key in ("events", "data"):
        if isinstance(data.get(key), list):
            return data[key]
    return [data]


def _version(row: Row) -> tuple[int, str]:
    found = str(row.get("_xact_id") or "")
    return (int(found), found) if found.isdigit() else (-1, found)


def latest(rows: Iterable[Row]) -> list[Row]:
    kept: dict[str, Row] = {}
    for row in rows:
        key = str(row.get("id"))
        if key not in kept or _version(row) >= _version(kept[key]):
            kept[key] = row
    return [row for row in kept.values() if not row.get("_object_delete")]


def read_export(path: Path) -> list[Row]:
    return latest(_parsed(_text(path)))


def _is_root(row: Row) -> bool:
    if row.get("is_root") is not None:
        return bool(row["is_root"])
    if row.get("span_parents"):
        return False
    span, root = row.get("span_id"), row.get("root_span_id")
    return span is None or root is None or span == root


def _span(row: Row) -> Mapping[str, Any]:
    return row.get("span_attributes") or {}


def spans(rows: Iterable[Row], span_type: str | None = None) -> Iterator[Row]:
    for row in rows:
        if span_type is None and _is_root(row):
            yield row
        elif span_type is not None and _span(row).get("type") == span_type:
            yield row


def _error(row: Row) -> str | None:
    error = row.get("error")
    if error is None or error == "":
        return None
    return error if isinstance(error, str) else json.dumps(error, sort_keys=True, default=str)


def _answer(value: Any) -> Any:
    if isinstance(value, list) and value and isinstance(value[0], Mapping):
        first = value[0]
        if "message" in first:
            return first["message"]
    return value


def _output(row: Row) -> TeacherOutput | None:
    error = _error(row)
    if error is not None:
        return TeacherOutput(error=error)
    text = output_text(_answer(row.get("output")))
    return None if text is None else TeacherOutput(text)


def _model(row: Row) -> str | None:
    model = (row.get("metadata") or {}).get("model")
    return None if model is None else str(model)


def records(rows: Iterable[Row], span_type: str | None = None) -> Iterator[Record]:
    for row in spans(rows, span_type):
        value = row.get("input")
        if value is None:
            continue
        keys = {name: str(row[name]) for name in ("id", "span_id", "root_span_id") if row.get(name)}
        yield Record(
            input=value,
            model=_model(row) or f"braintrust:{_span(row).get('name') or 'unnamed'}",
            output=_output(row),
            keys=keys,
        )


def benchmark_cases(rows: Iterable[Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(row["id"]),
            "input": row["input"],
            "expected": row["expected"],
            "tags": list(row.get("tags") or []),
        }
        for row in spans(rows)
        if row.get("input") is not None and row.get("expected") is not None
    ]


def write_cases(cases: Sequence[Mapping[str, Any]], path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(case, sort_keys=True) + "\n" for case in cases))
    return len(cases)


def _score_names(rows: Sequence[Row]) -> list[str]:
    return sorted(
        {
            name
            for row in rows
            for name, value in (row.get("scores") or {}).items()
            if value is not None
        }
    )


def _scorer(rows: Sequence[Row], wanted: str | None) -> str:
    names = _score_names(rows)
    if wanted is not None:
        if wanted not in names:
            raise ValueError(f"no score {wanted!r} in the experiment; it has {', '.join(names)}")
        return wanted
    if not names:
        raise ValueError("the experiment has no scores to import")
    if len(names) > 1:
        raise ValueError(f"the experiment has several scores; pick one: {', '.join(names)}")
    return names[0]


def _case_key(row: Row) -> str:
    origin = row.get("origin") or {}
    if origin.get("id"):
        return str(origin["id"])
    if row.get("input") is not None:
        return input_hash(row["input"])[:16]
    return str(row["id"])


def _latency(row: Row) -> float | None:
    metrics = row.get("metrics") or {}
    start, end = metrics.get("start"), metrics.get("end")
    if start is None or end is None:
        return None
    return (float(end) - float(start)) * 1000


def _trial_score(row: Row, scorer: str) -> float | None:
    value = (row.get("scores") or {}).get(scorer)
    if value is not None:
        return float(value)
    return 0.0 if _error(row) is not None else None


def _case(case_id: str, trials: Sequence[Row], scorer: str) -> ImportedCase | None:
    scores = [score for row in trials if (score := _trial_score(row, scorer)) is not None]
    if not scores:
        return None
    metrics: dict[str, list[float]] = {}
    for row in trials:
        for name, value in (row.get("scores") or {}).items():
            if name != scorer and value is not None:
                metrics.setdefault(name, []).append(float(value))
    latencies = [found for row in trials if (found := _latency(row)) is not None]
    errors = [error for row in trials if (error := _error(row)) is not None]
    first = trials[0]
    return ImportedCase(
        id=case_id,
        input=first.get("input"),
        expected=first.get("expected"),
        score=fmean(scores),
        output=first.get("output"),
        error="; ".join(errors) or None,
        metrics={name: fmean(values) for name, values in metrics.items()},
        latency_ms=fmean(latencies) if latencies else None,
    )


def experiment_run(
    rows: Iterable[Row], model: str | None = None, scorer: str | None = None
) -> ImportedRun:
    roots = list(spans(rows))
    chosen = _scorer(roots, scorer)
    grouped: dict[str, list[Row]] = {}
    for row in roots:
        grouped.setdefault(_case_key(row), []).append(row)
    cases = [_case(case_id, trials, chosen) for case_id, trials in grouped.items()]
    named = next((found for row in roots if (found := _model(row))), None)
    return ImportedRun(
        model or named or SOURCE, SOURCE, tuple(case for case in cases if case is not None)
    )
