import hashlib
import json
from datetime import datetime
from typing import Any

from modelstill.serve.router import ServingEvent


def clickhouse_time(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def request_hash(request: dict) -> str:
    canonical = json.dumps(request.get("messages"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def serving_row(
    event: ServingEvent, deployment_id: str, request_hash: str, ts: datetime
) -> dict[str, Any]:
    return {
        "ts": clickhouse_time(ts),
        "task": event.task,
        "deployment_id": deployment_id,
        "request_hash": request_hash,
        "mode": event.mode,
        "served_from": event.served_from,
        "deferred": event.deferred,
        "reason": event.reason,
        "confidence": event.confidence,
        "student_model": event.student_model,
        "model_match": event.model_match,
        "student_output": event.student_output,
        "cloud_model": event.cloud_model,
        "cloud_output": event.cloud_output,
        "student_ms": event.student_ms,
        "cloud_ms": event.cloud_ms,
        "student_cost_usd": None,
        "cloud_cost_usd": None,
    }
