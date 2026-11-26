import base64
import email.message
import io
import json
import urllib.error
import urllib.request
from typing import IO, Any
from urllib.parse import parse_qs, urlparse

import pytest

from modelstill.data import TeacherOutput
from modelstill.ingest.langfuse import LangfuseError, LangfuseReader, records

MESSAGES = [{"role": "user", "content": "Extract the tools: Python, dbt"}]


def generation(number: int, **extra: Any) -> dict[str, Any]:
    return {
        "id": f"obs-{number}",
        "traceId": f"trace-{number}",
        "type": "GENERATION",
        "name": "technographics",
        "startTime": "2026-11-20T10:00:00.000Z",
        "model": "gpt-5-mini",
        "level": "DEFAULT",
        "input": json.dumps(MESSAGES) if number % 2 else MESSAGES,
        "output": json.dumps({"role": "assistant", "content": f"answer {number}"}),
        **extra,
    }


class FakeLangfuse:
    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> IO[bytes]:
        self.requests.append(request)
        return io.BytesIO(json.dumps(self.pages[len(self.requests) - 1]).encode())

    def query(self, index: int) -> dict[str, list[str]]:
        return parse_qs(urlparse(self.requests[index].full_url).query)


def test_v2_follows_the_cursor_until_it_is_absent() -> None:
    fake = FakeLangfuse(
        [
            {"data": [generation(1)], "meta": {"cursor": "c1"}},
            {"data": [], "meta": {"cursor": "c2"}},
            {"data": [generation(2)], "meta": {}},
        ]
    )
    reader = LangfuseReader("https://lf.example/", "pk-1", "sk-1", opener=fake)

    found = list(
        reader.observations("2026-11-01T00:00:00Z", "2026-11-24T00:00:00Z", name="technographics")
    )

    assert [row["id"] for row in found] == ["obs-1", "obs-2"]
    first = fake.requests[0]
    assert first.get_method() == "GET"
    assert urlparse(first.full_url).path == "/api/public/v2/observations"
    token = base64.b64encode(b"pk-1:sk-1").decode()
    assert first.get_header("Authorization") == f"Basic {token}"
    query = fake.query(0)
    assert query["type"] == ["GENERATION"]
    assert query["fromStartTime"] == ["2026-11-01T00:00:00Z"]
    assert query["toStartTime"] == ["2026-11-24T00:00:00Z"]
    assert query["name"] == ["technographics"]
    assert set(query["fields"][0].split(",")) >= {"core", "basic", "io", "model"}
    assert "cursor" not in query
    assert fake.query(1)["cursor"] == ["c1"]
    assert fake.query(2)["cursor"] == ["c2"]


def test_v1_walks_pages_until_the_last_one() -> None:
    fake = FakeLangfuse(
        [
            {"data": [generation(1)], "meta": {"page": 1, "totalPages": 2}},
            {"data": [generation(2)], "meta": {"page": 2, "totalPages": 2}},
        ]
    )
    reader = LangfuseReader("https://lf.example", "pk", "sk", api="v1", opener=fake)

    found = list(reader.observations("2026-11-01T00:00:00Z"))

    assert len(found) == 2
    assert urlparse(fake.requests[0].full_url).path == "/api/public/observations"
    assert fake.query(0)["page"] == ["1"]
    assert fake.query(1)["page"] == ["2"]
    assert "toStartTime" not in fake.query(0)


def test_http_errors_carry_the_status_and_body() -> None:
    def failing(request: urllib.request.Request, timeout: float) -> IO[bytes]:
        raise urllib.error.HTTPError(
            request.full_url, 401, "Unauthorized", email.message.Message(), io.BytesIO(b"bad keys")
        )

    reader = LangfuseReader("https://lf.example", "pk", "sk", opener=failing)

    with pytest.raises(LangfuseError, match="401: bad keys"):
        list(reader.observations("2026-11-01T00:00:00Z"))


def test_records_parse_io_and_key_outputs_by_model() -> None:
    rows = [
        generation(1),
        generation(2, model=None),
        generation(3, level="ERROR", statusMessage="rate limited", output=None),
        generation(4, input=None),
    ]

    found = list(records(rows))

    assert len(found) == 3
    assert found[0].input == MESSAGES
    assert found[0].model == "gpt-5-mini"
    assert found[0].output == TeacherOutput("answer 1")
    assert found[0].keys == {"trace_id": "trace-1", "observation_id": "obs-1"}
    assert found[1].model == "langfuse:technographics"
    assert found[2].output == TeacherOutput(error="rate limited")
