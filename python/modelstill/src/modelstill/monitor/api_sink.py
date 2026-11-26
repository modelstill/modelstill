import json
import logging
import os
import tempfile
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from modelstill.jsonl import jsonl_lines
from modelstill.monitor.alerts import Alert
from modelstill.monitor.canary import CANARY_RUNS
from modelstill.monitor.watch import WATCH_RUNS
from modelstill.push import PushClient
from modelstill.sinks import Row

_log = logging.getLogger(__name__)

OUTBOX_FILE = "api-outbox.jsonl"
API_TIMEOUT_SECONDS = 10.0
_CLICKHOUSE_TIME = "%Y-%m-%d %H:%M:%S.%f"


@dataclass(frozen=True)
class FlushResult:
    sent: int
    kept: int
    error: str | None


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(ts: str) -> str:
    return datetime.strptime(ts, _CLICKHOUSE_TIME).replace(tzinfo=UTC).isoformat()


def _canary_run(table: str, row: Row) -> Row | None:
    if table == CANARY_RUNS:
        passed, total, low, high = row["passed"], row["items"], row["low"], row["high"]
    elif table == WATCH_RUNS and row.get("canary_items") is not None:
        passed, total = row["canary_passed"], row["canary_items"]
        low, high = row["canary_low"], row["canary_high"]
    else:
        return None
    return {
        "id": row["run_id"],
        "createdAt": _iso(row["ts"]),
        "provider": row["provider"],
        "passed": passed,
        "total": total,
        "low": low,
        "high": high,
    }


def _batches(rows: Sequence[Row], size: int) -> list[list[Row]]:
    return [list(rows[start : start + size]) for start in range(0, len(rows), size)]


class ApiMonitorSink:
    def __init__(
        self,
        client: PushClient,
        task: str,
        state_dir: Path,
        clock: Callable[[], datetime] = _now,
        batch_size: int = 500,
        max_outbox: int = 5000,
    ) -> None:
        self.task = task
        self._client = client
        self._outbox = state_dir / OUTBOX_FILE
        self._clock = clock
        self._batch_size = batch_size
        self._max_outbox = max_outbox
        self._pending: list[Row] = []

    def send(self, alert: Alert) -> None:
        body = {
            "id": str(uuid.uuid4()),
            "kind": alert.kind,
            "severity": alert.level,
            "createdAt": self._clock().isoformat(),
            "payload": {"message": alert.message, "details": alert.details},
        }
        self._pending.append({"kind": "alert", "body": body})

    def write(self, table: str, rows: list[Row]) -> None:
        for row in rows:
            try:
                run = _canary_run(table, row)
            except (KeyError, TypeError, ValueError) as error:
                _log.warning("cannot send a %s row to the API: %s", table, error)
                continue
            if run is not None:
                self._pending.append({"kind": "canary", "body": run})

    def flush(self) -> FlushResult:
        queued = self._read_outbox() + self._pending
        self._pending = []
        if not queued:
            return FlushResult(0, 0, None)
        sent, kept, error = 0, [], None
        senders = (("canary", self._client.canaries), ("alert", self._client.alerts))
        for kind, push in senders:
            rows = [row for row in queued if row["kind"] == kind]
            for batch in _batches(rows, self._batch_size):
                try:
                    push(self.task, [row["body"] for row in batch])
                except Exception as failure:  # noqa: BLE001
                    error = f"{type(failure).__name__}: {failure}"
                    kept.extend(batch)
                    continue
                sent += len(batch)
        kept = kept[-self._max_outbox :]
        try:
            self._write_outbox(kept)
        except OSError as failure:
            error = f"{type(failure).__name__}: {failure}"
        return FlushResult(sent, len(kept), error)

    def rollback(self) -> str:
        try:
            record = self._client.deployment(self.task)
            if record is None:
                return f"the API holds no deployment for {self.task}; nothing to set off"
            update = {
                "mode": "off",
                "studentModel": record["studentModel"],
                "threshold": record["threshold"],
                "targetError": record["targetError"],
                "shadowSample": record["shadowSample"],
            }
            self._client.set_deployment(self.task, update)
        except Exception as failure:  # noqa: BLE001
            return f"could not set the API deployment of {self.task} off: {failure}"
        return f"set the API deployment of {self.task} to mode off"

    def _read_outbox(self) -> list[Row]:
        try:
            text = self._outbox.read_text()
        except OSError:
            return []
        rows: list[Row] = []
        for line in jsonl_lines(text):
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and row.get("kind") in ("canary", "alert"):
                rows.append(row)
        return rows

    def _write_outbox(self, rows: list[Row]) -> None:
        if not rows:
            self._outbox.unlink(missing_ok=True)
            return
        self._outbox.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=self._outbox.parent, prefix=f".{OUTBOX_FILE}.")
        with os.fdopen(handle, "w") as stream:
            stream.writelines(json.dumps(row, default=str) + "\n" for row in rows)
        Path(temporary).replace(self._outbox)


def api_sink_from(
    task: str,
    state_dir: Path,
    url: str | None = None,
    disabled: bool = False,
    environ: Mapping[str, str] = os.environ,
) -> ApiMonitorSink | None:
    if disabled:
        return None
    token = environ.get("MODELSTILL_API_TOKEN")
    if url is not None and not token:
        raise ValueError("--api needs MODELSTILL_API_TOKEN set to an API key or the admin token")
    base = url or environ.get("MODELSTILL_API_URL")
    if not base or not token:
        return None
    client = PushClient(base, token=token, timeout=API_TIMEOUT_SECONDS)
    return ApiMonitorSink(client, task, state_dir)
