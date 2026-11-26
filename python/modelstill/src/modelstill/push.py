import hashlib
import json
import math
import subprocess
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import IO, Any

from modelstill.attest import ATTESTATION_FILE
from modelstill.benchmark import HistoryEntry
from modelstill.evals import ScoredCase, compare
from modelstill.gate import Decision, Measurements
from modelstill.jsonl import jsonl_lines
from modelstill.spec import load_spec, snapshot_hash
from modelstill.train import ARTIFACT_FILE, load_artifact, served_name

Opener = Callable[[urllib.request.Request, float], IO[bytes]]

REVIEW_BATCH = 500
TRAIN_METRICS_BATCH = 1000
LOG_HISTORY_FILE = "log_history.json"
STEP_FIELDS = frozenset({"step", "epoch"})
GATE_NAMESPACE = uuid.UUID("6f1d3c2e-8a4b-4f7e-9c1d-2b3a4c5d6e7f")
REVIEW_STATES = ("none", "queued", "accepted", "corrected")
WORST_CASE_VALUES = {"flip_rate": 1.0, "cost_ratio": 9.0, "p95_latency_ms": 99999.0}
WORST_CASE_REASON = (
    "Not measured, so it was recorded at its failing worst-case value: a missing measurement "
    "can never pass the gate."
)


class PushError(Exception):
    pass


def _default_opener(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class PushClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float = 60.0,
        opener: Opener | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._opener = opener

    def send(self, method: str, path: str, body: object = None) -> dict[str, Any]:
        request = urllib.request.Request(
            self._base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"},
            method=method,
        )
        opener = self._opener or _default_opener
        try:
            with opener(request, self._timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:1000]
            raise PushError(f"{method} {path}: {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise PushError(f"{method} {path}: {error.reason}") from error

    def task(self, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.send("PUT", f"/v1/tasks/{slug}", payload)

    def run(self, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.send("POST", f"/v1/tasks/{slug}/eval-runs", payload)

    def gate(self, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.send("POST", f"/v1/tasks/{slug}/gates", payload)

    def review(self, slug: str, items: Sequence[dict[str, Any]]) -> int:
        upserted = 0
        for batch in _batches(items, REVIEW_BATCH):
            upserted += int(
                self.send("POST", f"/v1/tasks/{slug}/review-items", {"items": batch})["upserted"]
            )
        return upserted

    def deployment(self, slug: str) -> dict[str, Any] | None:
        return self.send("GET", f"/v1/tasks/{slug}/deployment")["deployment"]

    def set_deployment(self, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.send("PUT", f"/v1/tasks/{slug}/deployment", payload)

    def canaries(self, slug: str, runs: Sequence[dict[str, Any]]) -> int:
        return int(
            self.send("POST", f"/v1/tasks/{slug}/canaries", {"runs": list(runs)})["recorded"]
        )

    def alerts(self, slug: str, alerts: Sequence[dict[str, Any]]) -> int:
        reply = self.send("POST", f"/v1/tasks/{slug}/alerts", {"alerts": list(alerts)})
        return int(reply["recorded"])

    def train_run(self, slug: str, key: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.send("PUT", f"/v1/tasks/{slug}/train-runs/{key}", payload)

    def train_metrics(self, key: str, points: Sequence[dict[str, Any]]) -> int:
        accepted = 0
        for batch in _batches(points, TRAIN_METRICS_BATCH):
            reply = self.send("POST", f"/v1/train-runs/{key}/metrics", {"metrics": batch})
            accepted += int(reply["accepted"])
        return accepted


def _batches(items: Sequence[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield list(items[start : start + size])


def git_sha(cwd: Path) -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return completed.stdout.strip() or "unknown"


def task_payload(spec_path: Path, git_sha: str) -> dict[str, Any]:
    spec = load_spec(spec_path)
    return {
        "version": spec.version,
        "snapshotHash": snapshot_hash(spec_path),
        "gitSha": git_sha,
        "spec": spec.model_dump(mode="json"),
    }


def _case_payload(entry: HistoryEntry, scored: ScoredCase, content: bool) -> dict[str, Any]:
    case: dict[str, Any] = {"inputHash": scored.case_id, "score": scored.score}
    detail = entry.details.get(scored.case_id)
    if content:
        case["output"] = scored.output
        if detail is not None and detail.input is not None:
            case["input"] = detail.input
        if detail is not None and detail.expected is not None:
            case["expected"] = detail.expected
    if detail is not None and detail.metrics:
        case["metrics"] = dict(detail.metrics)
    return case


def run_payload(
    entry: HistoryEntry,
    primary_metric: str | None,
    split: str,
    judge_model: str | None = None,
    content: bool = True,
) -> dict[str, Any]:
    return {
        "id": entry.id,
        "createdAt": entry.created_at,
        "model": entry.model,
        "split": split,
        "judgeModel": judge_model,
        "benchmark": {"name": entry.benchmark, "version": entry.version},
        "metrics": {name: asdict(metric) for name, metric in entry.metrics.items()},
        "primaryMetric": primary_metric if primary_metric in entry.metrics else None,
        "cases": [_case_payload(entry, scored, content) for scored in entry.result.scores],
    }


def measurements(
    entry: HistoryEntry,
    primary_metric: str | None,
    flip_rate: float,
    cost_ratio: float,
    p95_latency_ms: int,
    previous: HistoryEntry | None = None,
) -> Measurements:
    metric = entry.metrics.get(primary_metric) if primary_metric else None
    result = entry.result
    return Measurements(
        metric_mean=metric.value if metric else result.mean,
        metric_low=metric.low if metric else result.low,
        metric_cases=len(result.scores),
        flip_rate=flip_rate,
        cost_ratio=cost_ratio,
        p95_latency_ms=p95_latency_ms,
        baseline_difference_low=(
            None if previous is None else compare(previous.result, entry.result).low
        ),
    )


def not_measured(decision: Decision, given: Mapping[str, str | None]) -> dict[str, str]:
    checks = {check.name: check for check in decision.checks}
    for name in given:
        if name not in checks:
            raise ValueError(
                f"--not-measured {name}: the gate has no such check ({', '.join(checks)})"
            )
        if checks[name].passed:
            raise ValueError(
                f"--not-measured {name}: the check passed; "
                "record it at its failing worst-case value"
            )
    found = {
        check.name: WORST_CASE_REASON
        for check in decision.checks
        if not check.passed and WORST_CASE_VALUES.get(check.name) == check.value
    }
    found.update({name: reason or WORST_CASE_REASON for name, reason in given.items()})
    return found


def gate_payload(
    entry: HistoryEntry,
    previous: HistoryEntry | None,
    decision: Decision,
    measured: Measurements,
    primary_metric: str | None,
    gate_settings: dict[str, Any],
    unmeasured: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    used_metric = primary_metric if primary_metric in entry.metrics else None
    report: dict[str, Any] = {
        **decision.to_report(),
        "measurements": measured.model_dump(),
        "primaryMetric": used_metric,
        "gate": gate_settings,
        "benchmark": {"name": entry.benchmark, "version": entry.version},
    }
    if unmeasured:
        report["notMeasured"] = dict(unmeasured)
    fingerprint = json.dumps(
        [entry.id, previous.id if previous else None, report], sort_keys=True, default=str
    )
    return {
        "id": str(uuid.uuid5(GATE_NAMESPACE, fingerprint)),
        "evalRunId": entry.id,
        "previousEvalRunId": previous.id if previous else None,
        "passed": decision.passed,
        "checks": [asdict(check) for check in decision.checks],
        "report": report,
    }


def _stable_hash(value: object) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _agreement(teacher_outputs: object) -> bool | None:
    if not isinstance(teacher_outputs, dict) or len(teacher_outputs) < 2:
        return None
    answers = [_stable_hash(answer) for answer in teacher_outputs.values()]
    return len(set(answers)) == 1


def review_items(path: Path) -> list[dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for number, line in enumerate(jsonl_lines(path.read_text()), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        if "input" not in row:
            raise ValueError(f"line {number}: every item needs an input")
        if "outputs" in row:
            teacher_outputs = {
                name: out["output"]
                for name, out in row["outputs"].items()
                if out.get("output") is not None and out.get("error") is None
            }
        else:
            teacher_outputs = row.get("teacher_outputs")
        agreement = row["agreement"] if "agreement" in row else _agreement(teacher_outputs)
        state = row.get("review_state") or ("queued" if agreement is False else "none")
        if state not in REVIEW_STATES:
            raise ValueError(f"line {number}: unknown review_state {state!r}")
        key = row.get("input_hash") or _stable_hash(row["input"])
        items[key] = {
            "inputHash": key,
            "input": row["input"],
            "teacherOutputs": teacher_outputs,
            "agreement": agreement,
            "reviewState": state,
        }
    return list(items.values())


def _finite(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def step_points(step: int, epoch: float | None, logs: Mapping[str, object]) -> list[dict[str, Any]]:
    at_epoch = _finite(epoch)
    points: list[dict[str, Any]] = []
    for name, raw in logs.items():
        value = _finite(raw)
        if name in STEP_FIELDS or value is None:
            continue
        points.append({"step": step, "epoch": at_epoch, "name": name, "value": value})
    return points


def metric_points(history: Sequence[Mapping[str, object]]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for entry in history:
        step = entry.get("step")
        if isinstance(step, bool) or not isinstance(step, int):
            continue
        epoch = _finite(entry.get("epoch"))
        points.extend(step_points(step, epoch, entry))
    return points


def train_run_payload(artifact_dir: Path) -> tuple[str, dict[str, Any]]:
    artifact = load_artifact(artifact_dir)
    manifest = artifact.manifest.model_dump(mode="json")
    finished = datetime.fromtimestamp((artifact_dir / ARTIFACT_FILE).stat().st_mtime, UTC)
    payload: dict[str, Any] = {
        "base": artifact.base,
        "method": str(manifest["plan"].get("method", artifact.kind)),
        "status": "succeeded",
        "manifest": manifest,
        "finalMetrics": {
            name: value
            for name, raw in artifact.metrics.items()
            if (value := _finite(raw)) is not None
        },
        "finishedAt": finished.isoformat(),
    }
    runtime = _finite(artifact.metrics.get("train_runtime_s"))
    if runtime is not None:
        payload["startedAt"] = (finished - timedelta(seconds=runtime)).isoformat()
    attestation = artifact_dir / ATTESTATION_FILE
    if attestation.exists():
        payload["attestation"] = json.loads(attestation.read_text())
    return served_name(artifact_dir), payload


def log_history_points(artifact_dir: Path) -> list[dict[str, Any]]:
    path = artifact_dir / LOG_HISTORY_FILE
    if not path.exists():
        return []
    history = json.loads(path.read_text())
    if not isinstance(history, list):
        raise ValueError(f"{path}: expected a list of log entries")
    return metric_points([entry for entry in history if isinstance(entry, dict)])
