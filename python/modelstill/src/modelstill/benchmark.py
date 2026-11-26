import hashlib
import json
import uuid
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from modelstill.evals import Case, PooledF1, RunResult, ScoredCase
from modelstill.jsonl import jsonl_lines
from modelstill.stats import Estimate


@dataclass(frozen=True)
class Benchmark:
    name: str
    cases: tuple[Case, ...]

    @property
    def version(self) -> str:
        canonical = json.dumps(
            [[case.id, case.input, case.expected, list(case.tags)] for case in self.cases],
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    def tagged(self, tag: str) -> "Benchmark":
        return Benchmark(
            name=f"{self.name}[{tag}]",
            cases=tuple(case for case in self.cases if tag in case.tags),
        )


def load_benchmark(path: Path) -> Benchmark:
    cases: list[Case] = []
    seen: set[str] = set()
    for number, line in enumerate(jsonl_lines(path.read_text()), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        case_id = row.get("id")
        if not isinstance(case_id, str) or not case_id:
            raise ValueError(f"line {number}: every case needs a string id")
        if case_id in seen:
            raise ValueError(f"line {number}: duplicate id {case_id!r}")
        seen.add(case_id)
        cases.append(
            Case(
                id=case_id,
                input=row.get("input"),
                expected=row.get("expected"),
                tags=tuple(row.get("tags", ())),
            )
        )
    return Benchmark(name=path.stem, cases=tuple(cases))


@dataclass(frozen=True)
class MetricValue:
    value: float
    low: float
    high: float


@dataclass(frozen=True)
class CaseDetail:
    input: Any
    expected: Any
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class HistoryEntry:
    id: str
    model: str
    benchmark: str
    version: str
    created_at: str
    result: RunResult
    metrics: dict[str, MetricValue] = field(default_factory=dict)
    details: dict[str, CaseDetail] = field(default_factory=dict)


def _metric_value(metric: PooledF1 | Estimate | MetricValue) -> MetricValue:
    if isinstance(metric, PooledF1):
        return MetricValue(metric.f1, metric.low, metric.high)
    return MetricValue(metric.value, metric.low, metric.high)


def result_to_json(result: RunResult) -> dict[str, Any]:
    return {
        "mean": result.mean,
        "low": result.low,
        "high": result.high,
        "binary": result.binary,
        "scores": [asdict(score) for score in result.scores],
    }


def result_from_json(data: dict[str, Any]) -> RunResult:
    return RunResult(
        scores=tuple(ScoredCase(**score) for score in data["scores"]),
        mean=data["mean"],
        low=data["low"],
        high=data["high"],
        binary=data["binary"],
    )


def _entry(row: dict[str, Any]) -> HistoryEntry:
    return HistoryEntry(
        id=row["id"],
        model=row["model"],
        benchmark=row["benchmark"],
        version=row["version"],
        created_at=row["created_at"],
        result=result_from_json(row["result"]),
        metrics={name: MetricValue(**value) for name, value in row.get("metrics", {}).items()},
        details={case_id: CaseDetail(**value) for case_id, value in row.get("cases", {}).items()},
    )


def _details(
    benchmark: Benchmark,
    result: RunResult,
    case_metrics: Mapping[str, Mapping[str, float]],
) -> dict[str, dict[str, Any]]:
    scored = {score.case_id for score in result.scores}
    return {
        case.id: asdict(CaseDetail(case.input, case.expected, dict(case_metrics.get(case.id, {}))))
        for case in benchmark.cases
        if case.id in scored
    }


class History:
    def __init__(self, path: Path) -> None:
        self._path = path

    def _rows(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        return [json.loads(line) for line in jsonl_lines(self._path.read_text()) if line.strip()]

    def _append(self, row: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a") as handle:
            handle.write(json.dumps(row, default=str) + "\n")

    def record(
        self,
        benchmark: Benchmark,
        model: str,
        result: RunResult,
        metrics: Mapping[str, PooledF1 | Estimate | MetricValue] | None = None,
        case_metrics: Mapping[str, Mapping[str, float]] | None = None,
        run_id: str | None = None,
    ) -> str:
        run_id = run_id or uuid.uuid4().hex
        self._append(
            {
                "kind": "run",
                "id": run_id,
                "model": model,
                "benchmark": benchmark.name,
                "version": benchmark.version,
                "created_at": datetime.now(UTC).isoformat(),
                "result": result_to_json(result),
                "metrics": {
                    name: asdict(_metric_value(metric)) for name, metric in (metrics or {}).items()
                },
                "cases": _details(benchmark, result, case_metrics or {}),
            }
        )
        return run_id

    def accept(self, run_id: str) -> None:
        full_id = self.get(run_id).id
        self._append({"kind": "accept", "id": full_id, "at": datetime.now(UTC).isoformat()})

    def record_gate(self, run_id: str, baseline_id: str | None, report: Mapping[str, Any]) -> None:
        self._append(
            {
                "kind": "gate",
                "run": self.get(run_id).id,
                "baseline": baseline_id,
                "at": datetime.now(UTC).isoformat(),
                "report": dict(report),
            }
        )

    def gates(self) -> list[dict[str, Any]]:
        return [row for row in self._rows() if row["kind"] == "gate"]

    def runs(self) -> list[HistoryEntry]:
        return [_entry(row) for row in self._rows() if row["kind"] == "run"]

    def get(self, run_id: str) -> HistoryEntry:
        matches = [entry for entry in self.runs() if run_id and entry.id.startswith(run_id)]
        if len(matches) != 1:
            raise KeyError(run_id)
        return matches[0]

    def last_accepted(self, benchmark: Benchmark) -> HistoryEntry | None:
        rows = self._rows()
        runs = {row["id"]: row for row in rows if row["kind"] == "run"}
        for row in reversed(rows):
            if row["kind"] != "accept":
                continue
            accepted = runs[row["id"]]
            if accepted["version"] == benchmark.version:
                return _entry(accepted)
        return None
