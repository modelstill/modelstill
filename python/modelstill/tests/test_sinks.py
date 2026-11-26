import asyncio
import dataclasses
import io
import json
import os
import re
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from modelstill.serve.events import request_hash, serving_row
from modelstill.serve.router import ServingEvent
from modelstill.sinks import (
    BatchSink,
    ClickHouseStore,
    ClickHouseWriter,
    JsonlStore,
    JsonlWriter,
    SinkError,
)

SCHEMA = Path(__file__).resolve().parents[3] / "deploy" / "clickhouse" / "schema.sql"


class Recorder:
    def __init__(self, fail_first: int = 0) -> None:
        self.batches: list[list[dict]] = []
        self.fail_first = fail_first

    def insert(self, rows: list[dict]) -> None:
        if self.fail_first:
            self.fail_first -= 1
            raise SinkError("down")
        self.batches.append(list(rows))


async def test_close_writes_every_queued_row_in_bounded_batches() -> None:
    writer = Recorder()
    sink = BatchSink(writer, batch_size=2, flush_seconds=10)
    sink.start()
    for index in range(5):
        sink.put({"n": index})

    await sink.close()

    assert [len(batch) for batch in writer.batches] == [2, 2, 1]
    assert [row["n"] for batch in writer.batches for row in batch] == [0, 1, 2, 3, 4]
    assert sink.stats()["written"] == 5


async def test_a_full_queue_drops_and_counts_instead_of_blocking() -> None:
    writer = Recorder()
    sink = BatchSink(writer, max_queue=3, batch_size=10, flush_seconds=10)
    for index in range(5):
        sink.put({"n": index})

    assert sink.stats()["dropped"] == 2
    sink.start()
    await sink.close()
    assert sum(len(batch) for batch in writer.batches) == 3


async def test_a_failing_writer_is_counted_and_later_batches_still_go_out() -> None:
    writer = Recorder(fail_first=1)
    sink = BatchSink(writer, batch_size=1, flush_seconds=10)
    sink.start()
    sink.put({"n": 1})
    sink.put({"n": 2})

    await sink.close()

    assert sink.stats()["failed"] == 1
    assert writer.batches == [[{"n": 2}]]


async def test_rows_are_flushed_on_a_timer_without_closing() -> None:
    writer = Recorder()
    sink = BatchSink(writer, batch_size=100, flush_seconds=0.01)
    sink.start()
    sink.put({"n": 1})

    for _ in range(100):
        if writer.batches:
            break
        await asyncio.sleep(0.01)

    assert writer.batches == [[{"n": 1}]]
    await sink.close()


def test_jsonl_writer_appends_one_line_per_row(tmp_path: Path) -> None:
    path = tmp_path / "logs" / "events.jsonl"
    writer = JsonlWriter(path)

    writer.insert([{"a": 1}])
    writer.insert([{"a": 2}, {"a": 3}])

    assert [json.loads(line)["a"] for line in path.read_text().splitlines()] == [1, 2, 3]


class Opener:
    def __init__(self, status: int = 200) -> None:
        self.requests: list[urllib.request.Request] = []
        self.status = status

    def __call__(self, request: urllib.request.Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        return io.BytesIO(b"")


def test_clickhouse_writer_posts_json_each_row_with_credentials() -> None:
    opener = Opener()
    writer = ClickHouseWriter(
        "http://ch:8123", "modelstill.serving_events", user="writer", password="pw", opener=opener
    )

    writer.insert([{"a": 1}, {"a": 2}])

    request = opener.requests[0]
    query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
    assert query["query"] == ["INSERT INTO modelstill.serving_events FORMAT JSONEachRow"]
    assert query["date_time_input_format"] == ["best_effort"]
    assert request.get_header("X-clickhouse-user") == "writer"
    assert request.get_header("X-clickhouse-key") == "pw"
    assert request.data == b'{"a": 1}\n{"a": 2}\n'


def test_a_jsonl_store_keeps_one_file_per_table(tmp_path: Path) -> None:
    store = JsonlStore(tmp_path)

    store.write("modelstill.canary_runs", [{"a": 1}])

    assert (tmp_path / "modelstill.canary_runs.jsonl").read_text() == '{"a": 1}\n'


def test_a_clickhouse_store_inserts_into_the_named_table() -> None:
    opener = Opener()

    ClickHouseStore("http://ch:8123", opener=opener).write("modelstill.canary_runs", [{"a": 1}])

    query = urllib.parse.parse_qs(urllib.parse.urlparse(opener.requests[0].full_url).query)
    assert query["query"] == ["INSERT INTO modelstill.canary_runs FORMAT JSONEachRow"]


def test_clickhouse_writer_refuses_a_table_name_that_could_inject_sql() -> None:
    with pytest.raises(ValueError):
        ClickHouseWriter("http://ch:8123", "t; DROP TABLE x", opener=Opener())


EVENT = ServingEvent(
    task="technographics",
    mode="shadow",
    served_from="cloud",
    deferred=False,
    reason=None,
    confidence=0.91,
    student_output="{}",
    student_model="technographics-v1-s1",
    model_match=True,
    cloud_output='{"technologies": []}',
    cloud_model="technographics",
    student_ms=12.5,
    cloud_ms=830.0,
)


def schema_columns(table: str) -> list[str]:
    body = SCHEMA.read_text().split(f"CREATE TABLE IF NOT EXISTS {table}")[1].split("ENGINE")[0]
    return re.findall(r"^\s{4}(\w+)\s", body, flags=re.MULTILINE)


def test_a_serving_row_fills_every_column_of_the_table() -> None:
    row = serving_row(
        EVENT, deployment_id="abc", request_hash="h", ts=datetime(2026, 11, 23, 10, tzinfo=UTC)
    )

    assert list(row) == schema_columns("modelstill.serving_events")
    assert row["ts"] == "2026-11-23 10:00:00.000"
    assert row["confidence"] == 0.91


def test_the_request_hash_ignores_sampling_settings_but_not_the_messages() -> None:
    messages = [{"role": "user", "content": "Python"}]

    same = request_hash({"messages": messages, "temperature": 0})
    assert same == request_hash({"messages": messages, "temperature": 1, "model": "x"})
    assert same != request_hash({"messages": [{"role": "user", "content": "Go"}]})


@pytest.mark.skipif("CLICKHOUSE_URL" not in os.environ, reason="needs a ClickHouse server")
def test_writes_serving_events_to_clickhouse_and_reads_them_back() -> None:
    url = os.environ["CLICKHOUSE_URL"]
    writer = ClickHouseWriter(url, "modelstill.serving_events")
    marker = uuid.uuid4().hex
    event = dataclasses.replace(EVENT, task="modelstill-sink-integration-test")
    row = serving_row(event, deployment_id=marker, request_hash="it", ts=datetime.now(UTC))

    writer.insert([row])
    back = writer.select(
        "SELECT deployment_id, served_from, confidence FROM modelstill.serving_events "
        f"WHERE deployment_id = '{marker}'"
    )

    assert back == [{"deployment_id": marker, "served_from": "cloud", "confidence": 0.91}]
