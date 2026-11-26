import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from statistics import fmean
from typing import Any

from modelstill.ingest.runs import ImportedCase, ImportedRun

SOURCE = "promptfoo"


def _rows(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text())
    summary = data["results"] if isinstance(data.get("results"), Mapping) else data
    return list(summary.get("results") or [])


def _provider(row: Mapping[str, Any]) -> str:
    provider = row.get("provider") or {}
    return str(provider.get("label") or provider.get("id") or "promptfoo")


def _matches(row: Mapping[str, Any], wanted: str) -> bool:
    provider = row.get("provider") or {}
    return wanted in (provider.get("label"), provider.get("id"))


def _metrics(rows: Sequence[Mapping[str, Any]]) -> dict[str, float]:
    found: dict[str, list[float]] = {"score": [float(row.get("score", 0)) for row in rows]}
    for row in rows:
        for name, value in (row.get("namedScores") or {}).items():
            found.setdefault(name, []).append(float(value))
    return {name: fmean(values) for name, values in found.items()}


def _case(case_id: str, rows: Sequence[Mapping[str, Any]]) -> ImportedCase:
    first = rows[0]
    test = first.get("testCase") or {}
    errors = [str(row["error"]) for row in rows if row.get("error")]
    latencies = [float(row["latencyMs"]) for row in rows if row.get("latencyMs") is not None]
    return ImportedCase(
        id=case_id,
        input=first.get("vars", test.get("vars")),
        expected=test.get("assert"),
        score=fmean(1.0 if row.get("success") else 0.0 for row in rows),
        output=(first.get("response") or {}).get("output"),
        error="; ".join(errors) or None,
        metrics=_metrics(rows),
        latency_ms=fmean(latencies) if latencies else None,
    )


def _ids(rows: Sequence[Mapping[str, Any]]) -> dict[int, str]:
    described = {
        int(row["testIdx"]): (row.get("testCase") or {}).get("description") for row in rows
    }
    names = list(described.values())
    if all(names) and len(set(names)) == len(names):
        return {index: str(name) for index, name in described.items()}
    return {index: f"test-{index}" for index in described}


def _run(model: str, rows: Sequence[Mapping[str, Any]], ids: Mapping[int, str]) -> ImportedRun:
    by_test: dict[int, list[Mapping[str, Any]]] = {}
    for row in rows:
        by_test.setdefault(int(row["testIdx"]), []).append(row)
    cases = tuple(_case(ids[index], found) for index, found in sorted(by_test.items()))
    return ImportedRun(model, SOURCE, cases)


def load(path: Path, provider: str | None = None) -> list[ImportedRun]:
    rows = _rows(path)
    ids = _ids(rows)
    if provider is not None:
        rows = [row for row in rows if _matches(row, provider)]
        if not rows:
            raise ValueError(f"no results for provider {provider!r}")
    columns: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        columns.setdefault(int(row["promptIdx"]), []).append(row)
    shared = Counter(_provider(found[0]) for found in columns.values())
    runs: list[ImportedRun] = []
    for index, found in sorted(columns.items()):
        model = _provider(found[0])
        if shared[model] > 1:
            label = (found[0].get("prompt") or {}).get("label") or f"prompt {index}"
            model = f"{model} [{label}]"
        runs.append(_run(model, found, ids))
    return runs
