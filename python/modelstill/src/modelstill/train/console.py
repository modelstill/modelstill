import os
import time
from collections import deque
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from modelstill.push import PushClient, PushError, step_points

DEFAULT_API_URL = "http://localhost:8787"
CONSOLE_TIMEOUT_SECONDS = 5.0

Status = Literal["succeeded", "failed"]


def _now() -> str:
    return datetime.now(UTC).isoformat()


class ConsoleReporter:
    def __init__(
        self,
        client: PushClient,
        task: str,
        key: str,
        base: str,
        method: str,
        *,
        batch_size: int = 50,
        flush_seconds: float = 15.0,
        max_pending: int = 20_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.task = task
        self.key = key
        self.base = base
        self.method = method
        self.failures = 0
        self.dropped = 0
        self.sent = 0
        self._client = client
        self._batch_size = batch_size
        self._flush_seconds = flush_seconds
        self._max_pending = max_pending
        self._clock = clock
        self._pending: deque[dict[str, Any]] = deque()
        self._last_flush = clock()

    @property
    def pending(self) -> int:
        return len(self._pending)

    def start(
        self, manifest: Mapping[str, Any] | None = None, started_at: str | None = None
    ) -> bool:
        payload: dict[str, Any] = {
            "base": self.base,
            "method": self.method,
            "status": "running",
            "startedAt": started_at or _now(),
        }
        if manifest is not None:
            payload["manifest"] = dict(manifest)
        return self._put(payload)

    def on_log(self, step: int, epoch: float | None, logs: Mapping[str, float]) -> None:
        for point in step_points(step, epoch, logs):
            if len(self._pending) >= self._max_pending:
                self._pending.popleft()
                self.dropped += 1
            self._pending.append(point)
        quiet = self._clock() - self._last_flush >= self._flush_seconds
        if len(self._pending) >= self._batch_size or (quiet and self._pending):
            self.flush()

    def flush(self) -> bool:
        self._last_flush = self._clock()
        if not self._pending:
            return True
        batch = list(self._pending)
        try:
            self._client.train_metrics(self.key, batch)
        except (PushError, OSError, ValueError, KeyError):
            self.failures += 1
            return False
        for _ in batch:
            self._pending.popleft()
        self.sent += len(batch)
        return True

    def finish(
        self,
        status: Status,
        metrics: Mapping[str, float] | None = None,
        attestation: Mapping[str, Any] | None = None,
    ) -> bool:
        self.flush()
        payload: dict[str, Any] = {
            "base": self.base,
            "method": self.method,
            "status": status,
            "finishedAt": _now(),
        }
        if metrics is not None:
            payload["finalMetrics"] = {
                point["name"]: point["value"] for point in step_points(0, None, metrics)
            }
        if attestation is not None:
            payload["attestation"] = dict(attestation)
        return self._put(payload)

    def _put(self, payload: dict[str, Any]) -> bool:
        try:
            self._client.train_run(self.task, self.key, payload)
        except (PushError, OSError, ValueError, KeyError):
            self.failures += 1
            return False
        return True


def console_from_env(
    task: str, key: str, base: str, method: str, **options: Any
) -> ConsoleReporter | None:
    token = os.environ.get("MODELSTILL_API_TOKEN")
    if not token:
        return None
    url = os.environ.get("MODELSTILL_API_URL") or DEFAULT_API_URL
    client = PushClient(url, token=token, timeout=CONSOLE_TIMEOUT_SECONDS)
    return ConsoleReporter(client, task, key, base, method, **options)
