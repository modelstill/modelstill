import email.message
import gzip
import io
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import IO, Any
from urllib.parse import urlparse

import pytest

from modelstill.data import TeacherOutput, input_hash
from modelstill.ingest.braintrust import (
    BraintrustError,
    BraintrustReader,
    benchmark_cases,
    experiment_run,
    read_export,
    records,
)

FIXTURES = Path(__file__).parent / "fixtures" / "ingest"
LOGS = FIXTURES / "braintrust_logs.json"
DATASET = FIXTURES / "braintrust_dataset.jsonl"
EXPERIMENT = FIXTURES / "braintrust_experiment.jsonl"


class FakeBraintrust:
    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> IO[bytes]:
        self.requests.append(request)
        return io.BytesIO(json.dumps(self.pages[len(self.requests) - 1]).encode())

    def body(self, index: int) -> dict[str, Any]:
        data = self.requests[index].data
        assert isinstance(data, bytes)
        return json.loads(data)


def logs() -> list[dict[str, Any]]:
    return json.loads(LOGS.read_text())


def test_fetch_posts_with_the_key_and_follows_the_cursor() -> None:
    first, second, third, fourth = logs()
    fake = FakeBraintrust(
        [
            {"events": [fourth, third], "cursor": "c1"},
            {"events": [second, {**third, "_xact_id": "1"}], "cursor": "c2"},
            {"events": [first]},
        ]
    )
    reader = BraintrustReader("bt-key", "https://api.example/", opener=fake)

    found = list(reader.events("project_logs", "proj-1", page_size=2))

    assert [row["id"] for row in found] == ["log-4", "log-3", "log-2", "log-1"]
    assert found[1]["_xact_id"] == third["_xact_id"]
    request = fake.requests[0]
    assert request.get_method() == "POST"
    assert urlparse(request.full_url).path == "/v1/project_logs/proj-1/fetch"
    assert request.get_header("Authorization") == "Bearer bt-key"
    assert fake.body(0) == {"limit": 2}
    assert fake.body(1) == {"limit": 2, "cursor": "c1"}
    assert fake.body(2) == {"limit": 2, "cursor": "c2"}


def test_fetch_stops_on_an_empty_page_and_reads_datasets_and_experiments() -> None:
    fake = FakeBraintrust([{"events": [], "cursor": "stale"}, {"events": []}])
    reader = BraintrustReader("k", opener=fake)

    assert list(reader.events("dataset", "ds-1")) == []
    assert list(reader.events("experiment", "exp 1")) == []
    assert fake.requests[0].full_url == "https://api.braintrust.dev/v1/dataset/ds-1/fetch"
    assert urlparse(fake.requests[1].full_url).path == "/v1/experiment/exp%201/fetch"


def test_http_errors_carry_the_status_and_body() -> None:
    def failing(request: urllib.request.Request, timeout: float) -> IO[bytes]:
        raise urllib.error.HTTPError(
            request.full_url, 401, "Unauthorized", email.message.Message(), io.BytesIO(b"bad key")
        )

    reader = BraintrustReader("k", opener=failing)

    with pytest.raises(BraintrustError, match="401: bad key"):
        list(reader.events("project_logs", "p"))


def test_exports_read_as_json_arrays_fetch_bodies_sql_results_jsonl_and_gzip(
    tmp_path: Path,
) -> None:
    rows = logs()
    shapes = {
        "array.json": json.dumps(rows),
        "fetch.json": json.dumps({"events": rows, "cursor": "c"}),
        "sql.json": json.dumps({"data": rows, "schema": {}}),
        "rows.jsonl": "".join(json.dumps(row) + "\n" for row in rows),
    }
    for name, text in shapes.items():
        (tmp_path / name).write_text(text)
    (tmp_path / "rows.jsonl.gz").write_bytes(gzip.compress(shapes["rows.jsonl"].encode()))

    for name in [*shapes, "rows.jsonl.gz"]:
        assert [row["id"] for row in read_export(tmp_path / name)] == [
            "log-1",
            "log-2",
            "log-3",
            "log-4",
        ], name


def test_exports_keep_the_latest_version_of_each_row_and_drop_deleted_ones(
    tmp_path: Path,
) -> None:
    first, second, *_ = logs()
    path = tmp_path / "history.jsonl"
    rows = [
        {**first, "output": "old", "_xact_id": "1000192656880881000"},
        second,
        {**first, "_xact_id": "1000192656880881200"},
        {**second, "_xact_id": "1000192656880881300", "_object_delete": True},
    ]
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))

    [kept] = read_export(path)

    assert kept["id"] == "log-1"
    assert kept["_xact_id"] == "1000192656880881200"


def test_records_take_root_spans_and_key_outputs_by_model() -> None:
    found = list(records(logs()))

    assert [record.keys["id"] for record in found] == ["log-1", "log-2", "log-4"]
    first, task, failed = found
    assert first.input[-1]["content"] == "We use Python and dbt."
    assert first.model == "gpt-5-mini"
    assert first.output == TeacherOutput("python, dbt")
    assert first.keys == {"id": "log-1", "span_id": "span-1", "root_span_id": "span-1"}
    assert task.model == "braintrust:technographics"
    assert task.output == TeacherOutput('{"technologies":["kubernetes"]}')
    assert failed.output == TeacherOutput(error="RateLimitError: 429 Too Many Requests")


def test_records_can_pick_spans_by_type() -> None:
    found = list(records(logs(), span_type="llm"))

    assert [record.keys["id"] for record in found] == ["log-1", "log-3", "log-4"]
    assert found[1].model == "claude-haiku-4-5"
    assert found[1].output == TeacherOutput("kubernetes")


def test_dataset_rows_become_inputs_and_benchmark_cases() -> None:
    rows = read_export(DATASET)

    found = list(records(rows))
    cases = benchmark_cases(rows)

    assert [record.output for record in found] == [None, None, None]
    assert found[0].model == "braintrust:unnamed"
    assert cases == [
        {
            "id": "row-1",
            "input": {"text": "We use Python and dbt."},
            "expected": {"technologies": ["python", "dbt"]},
            "tags": ["easy"],
        },
        {
            "id": "row-2",
            "input": {"text": "We run Excel macros."},
            "expected": {"technologies": []},
            "tags": [],
        },
    ]


def test_an_experiment_becomes_a_run_scored_by_one_scorer() -> None:
    run = experiment_run(read_export(EXPERIMENT), scorer="ExactMatch")

    assert run.model == "gpt-5-mini"
    assert run.source == "braintrust"
    by_id = {case.id: case for case in run.cases}
    unlinked = input_hash({"text": "Our stack is Kubernetes."})[:16]
    assert set(by_id) == {"row-1", "row-2", unlinked}
    assert by_id["row-1"].score == 1.0
    assert by_id["row-1"].metrics == {"Factuality": pytest.approx(0.8)}
    assert by_id["row-1"].latency_ms == pytest.approx(820)
    assert by_id["row-1"].expected == {"technologies": ["python", "dbt"]}
    assert by_id["row-2"].score == pytest.approx(0.5)
    assert by_id["row-2"].latency_ms == pytest.approx(600)
    assert by_id["row-2"].metrics == {"Factuality": pytest.approx(0.4)}
    assert by_id[unlinked].score == 0.0
    assert by_id[unlinked].error == "TimeoutError: task took too long"


def test_an_experiment_with_several_scores_needs_a_scorer() -> None:
    rows = read_export(EXPERIMENT)

    with pytest.raises(ValueError, match="ExactMatch, Factuality"):
        experiment_run(rows)
    with pytest.raises(ValueError, match="no score 'Missing'"):
        experiment_run(rows, scorer="Missing")


def test_an_experiment_with_one_score_uses_it_and_the_model_can_be_named() -> None:
    rows = [
        {**row, "scores": {"Factuality": (row.get("scores") or {}).get("Factuality")}}
        for row in read_export(EXPERIMENT)
    ]

    run = experiment_run(rows, model="candidate")

    assert run.model == "candidate"
    assert {case.id: case.score for case in run.cases}["row-1"] == pytest.approx(0.8)
