import asyncio
import contextlib
import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import IO, Any, Protocol

from modelstill.jsonl import jsonl_lines

Row = dict[str, Any]
Opener = Callable[[urllib.request.Request, float], IO[bytes]]

_log = logging.getLogger(__name__)
_TABLE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")
READ_SETTINGS = {"max_execution_time": "10", "max_threads": "2", "max_memory_usage": "1000000000"}


class SinkError(Exception):
    pass


class Writer(Protocol):
    def insert(self, rows: list[Row]) -> None: ...


def _default_opener(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class ClickHouseWriter:
    def __init__(
        self,
        url: str,
        table: str,
        user: str | None = None,
        password: str | None = None,
        timeout: float = 10.0,
        opener: Opener = _default_opener,
    ) -> None:
        if not _TABLE.match(table):
            raise ValueError(f"not a table name: {table!r}")
        self._url = url.rstrip("/") + "/"
        self._table = table
        self._headers = {"Content-Type": "text/plain"}
        if user:
            self._headers["X-ClickHouse-User"] = user
        if password:
            self._headers["X-ClickHouse-Key"] = password
        self._timeout = timeout
        self._opener = opener

    def _post(self, params: dict[str, str], body: bytes) -> bytes:
        request = urllib.request.Request(
            self._url + "?" + urllib.parse.urlencode(params),
            data=body,
            headers=self._headers,
            method="POST",
        )
        try:
            with self._opener(request, self._timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            raise SinkError(f"ClickHouse {error.code}: {detail}") from error
        except OSError as error:
            raise SinkError(f"ClickHouse unreachable: {error}") from error

    def insert(self, rows: list[Row]) -> None:
        if not rows:
            return
        body = "".join(json.dumps(row, default=str) + "\n" for row in rows).encode()
        self._post(
            {
                "query": f"INSERT INTO {self._table} FORMAT JSONEachRow",
                "date_time_input_format": "best_effort",
            },
            body,
        )

    def select(self, sql: str) -> list[Row]:
        raw = self._post({**READ_SETTINGS}, (sql + " FORMAT JSONEachRow").encode())
        return [json.loads(line) for line in jsonl_lines(raw.decode()) if line.strip()]


class JsonlWriter:
    def __init__(self, path: Path) -> None:
        self._path = path

    def insert(self, rows: list[Row]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a") as handle:
            for row in rows:
                handle.write(json.dumps(row, default=str) + "\n")


class TableStore(Protocol):
    def write(self, table: str, rows: list[Row]) -> None: ...


class ClickHouseStore:
    def __init__(
        self,
        url: str,
        user: str | None = None,
        password: str | None = None,
        opener: Opener = _default_opener,
    ) -> None:
        self._url, self._user, self._password, self._opener = url, user, password, opener

    def write(self, table: str, rows: list[Row]) -> None:
        ClickHouseWriter(
            self._url, table, user=self._user, password=self._password, opener=self._opener
        ).insert(rows)


class JsonlStore:
    def __init__(self, directory: Path) -> None:
        self._directory = directory

    def write(self, table: str, rows: list[Row]) -> None:
        JsonlWriter(self._directory / f"{table}.jsonl").insert(rows)


class BatchSink:
    def __init__(
        self,
        writer: Writer,
        max_queue: int = 10_000,
        batch_size: int = 200,
        flush_seconds: float = 1.0,
    ) -> None:
        self._writer = writer
        self._queue: asyncio.Queue[Row] = asyncio.Queue(maxsize=max_queue)
        self._batch_size = batch_size
        self._flush_seconds = flush_seconds
        self._task: asyncio.Task[None] | None = None
        self._pending: list[Row] = []
        self._inflight: asyncio.Future[None] | None = None
        self._counts = {"written": 0, "dropped": 0, "failed": 0}

    def put(self, row: Row) -> None:
        try:
            self._queue.put_nowait(row)
        except asyncio.QueueFull:
            self._counts["dropped"] += 1

    def stats(self) -> dict[str, int]:
        return {**self._counts, "queued": self._queue.qsize()}

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._inflight is not None:
            await self._inflight
        rows = self._pending
        self._pending = []
        while not self._queue.empty():
            rows.append(self._queue.get_nowait())
        for start in range(0, len(rows), self._batch_size):
            await self._write(rows[start : start + self._batch_size])

    async def _write(self, batch: list[Row]) -> None:
        if not batch:
            return
        try:
            await asyncio.to_thread(self._writer.insert, batch)
        except Exception as error:  # noqa: BLE001
            self._counts["failed"] += len(batch)
            _log.warning("dropped %d rows: %s", len(batch), error)
            return
        self._counts["written"] += len(batch)

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            batch = self._pending = [await self._queue.get()]
            deadline = loop.time() + self._flush_seconds
            while len(batch) < self._batch_size:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    batch.append(await asyncio.wait_for(self._queue.get(), timeout=remaining))
                except TimeoutError:
                    break
            self._pending = []
            self._inflight = asyncio.ensure_future(self._write(batch))
            await asyncio.shield(self._inflight)
            self._inflight = None
