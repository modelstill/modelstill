import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from modelstill.ingest.runs import ImportedCase, ImportedRun, case_ids

SOURCE = "deepeval"


def _metrics(case: Mapping[str, Any]) -> dict[str, float]:
    return {
        str(metric["name"]): float(metric["score"])
        for metric in case.get("metricsData") or []
        if metric.get("score") is not None and not metric.get("error")
    }


def _error(case: Mapping[str, Any]) -> str | None:
    errors = [
        f"{metric['name']}: {metric['error']}"
        for metric in case.get("metricsData") or []
        if metric.get("error")
    ]
    return "; ".join(errors) or None


def _turns(case: Mapping[str, Any]) -> list[dict[str, Any]]:
    ordered = sorted(case.get("turns") or [], key=lambda turn: turn.get("order", 0))
    return [{"role": turn["role"], "content": turn["content"]} for turn in ordered]


def _single(case: Mapping[str, Any]) -> tuple[Any, Any, Any]:
    return case.get("input"), case.get("expectedOutput"), case.get("actualOutput")


def _conversation(case: Mapping[str, Any]) -> tuple[Any, Any, Any]:
    return _turns(case), case.get("expectedOutcome"), None


def _latency(case: Mapping[str, Any]) -> float | None:
    seconds = case.get("completionTime")
    return None if seconds is None else float(seconds) * 1000


def _test_run(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    return data.get("testRunData", data)


def load(path: Path, model: str | None = None) -> ImportedRun:
    data = _test_run(path)
    scored = [
        (case, _single(case))
        for case in data.get("testCases", [])
        if case.get("success") is not None
    ] + [(case, _conversation(case)) for case in data.get("conversationalTestCases", [])]
    ids = case_ids([str(c["name"]) for c, _ in scored], [fields[:2] for _, fields in scored])
    cases = tuple(
        ImportedCase(
            id=case_id,
            input=fields[0],
            expected=fields[1],
            score=1.0 if case["success"] else 0.0,
            output=fields[2],
            error=_error(case),
            metrics=_metrics(case),
            latency_ms=_latency(case),
        )
        for case_id, (case, fields) in zip(ids, scored, strict=True)
    )
    named = (data.get("hyperparameters") or {}).get("model")
    return ImportedRun(model or (str(named) if named else SOURCE), SOURCE, cases)
