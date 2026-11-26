import io
import json
import urllib.request
from pathlib import Path
from typing import IO, Any

import pytest

from modelstill import cli
from modelstill.benchmark import History, load_benchmark
from modelstill.cli import main
from modelstill.data import DatasetStore
from modelstill.ingest.braintrust import BraintrustReader

FIXTURES = Path(__file__).parent / "fixtures" / "ingest"


class FakeBraintrust:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.urls: list[str] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> IO[bytes]:
        self.urls.append(request.full_url)
        return io.BytesIO(json.dumps({"events": self.rows}).encode())


def fake_reader(
    monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]]
) -> tuple[FakeBraintrust, list[dict[str, Any]]]:
    fake = FakeBraintrust(rows)
    made: list[dict[str, Any]] = []

    def reader(api_key: str, api_url: str) -> BraintrustReader:
        made.append({"key": api_key, "url": api_url})
        return BraintrustReader(api_key, api_url, opener=fake)

    monkeypatch.setattr(cli, "BraintrustReader", reader)
    monkeypatch.setenv("BRAINTRUST_API_KEY", "bt-test")
    monkeypatch.delenv("BRAINTRUST_API_URL", raising=False)
    return fake, made


def test_ingest_braintrust_reads_an_export_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "dataset.jsonl"

    code = main(["ingest", "braintrust", str(FIXTURES / "braintrust_logs.json"), "--out", str(out)])

    assert code == 0
    items = DatasetStore(out).load()
    assert len(items) == 3
    assert items[0].outputs["gpt-5-mini"].output == "python, dbt"
    assert items[0].provenance.source == "braintrust"
    assert "read 3 records from braintrust into 3 items" in capsys.readouterr().out


def test_ingest_braintrust_fetches_project_logs_with_the_key_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rows = json.loads((FIXTURES / "braintrust_logs.json").read_text())
    fake, made = fake_reader(monkeypatch, rows)
    out = tmp_path / "dataset.jsonl"

    code = main(
        ["ingest", "braintrust", "--project-id", "proj-1", "--span-type", "llm", "--out", str(out)]
    )

    assert code == 0
    assert made == [{"key": "bt-test", "url": "https://api.braintrust.dev"}]
    assert fake.urls == ["https://api.braintrust.dev/v1/project_logs/proj-1/fetch"]
    models = {name for item in DatasetStore(out).load() for name in item.outputs}
    assert models == {"gpt-5-mini", "claude-haiku-4-5"}


def test_ingest_braintrust_dataset_writes_benchmark_cases(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rows = [
        json.loads(line)
        for line in (FIXTURES / "braintrust_dataset.jsonl").read_text().split("\n")
        if line
    ]
    fake, _ = fake_reader(monkeypatch, rows)
    monkeypatch.setenv("BRAINTRUST_API_URL", "https://api-eu.braintrust.dev")
    cases = tmp_path / "golden.jsonl"

    code = main(
        [
            "ingest",
            "braintrust",
            "--dataset-id",
            "ds-1",
            "--out",
            str(tmp_path / "dataset.jsonl"),
            "--cases",
            str(cases),
        ]
    )

    assert code == 0
    assert fake.urls == ["https://api-eu.braintrust.dev/v1/dataset/ds-1/fetch"]
    benchmark = load_benchmark(cases)
    assert [case.id for case in benchmark.cases] == ["row-1", "row-2"]
    assert benchmark.cases[0].tags == ("easy",)


def test_ingest_braintrust_needs_exactly_one_source_and_a_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    out = str(tmp_path / "d.jsonl")
    monkeypatch.delenv("BRAINTRUST_API_KEY", raising=False)

    assert main(["ingest", "braintrust", "--out", out]) == 1
    assert "one of" in capsys.readouterr().err
    assert (
        main(["ingest", "braintrust", "--project-id", "p", "--dataset-id", "d", "--out", out]) == 1
    )
    assert main(["ingest", "braintrust", "--project-id", "p", "--out", out]) == 1
    assert "BRAINTRUST_API_KEY" in capsys.readouterr().err


def test_import_braintrust_records_an_experiment_file_as_a_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    history = tmp_path / "runs.jsonl"

    code = main(
        [
            "import",
            "braintrust",
            str(FIXTURES / "braintrust_experiment.jsonl"),
            "--scorer",
            "ExactMatch",
            "--history",
            str(history),
            "--task",
            "technographics",
        ]
    )

    assert code == 0
    [entry] = History(history).runs()
    assert entry.model == "gpt-5-mini"
    assert len(entry.result.scores) == 3
    assert "Factuality" in entry.metrics
    assert "recorded" in capsys.readouterr().out


def test_import_braintrust_fetches_an_experiment_by_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rows = [
        json.loads(line)
        for line in (FIXTURES / "braintrust_experiment.jsonl").read_text().split("\n")
        if line
    ]
    fake, _ = fake_reader(monkeypatch, rows)
    history = tmp_path / "runs.jsonl"

    code = main(
        [
            "import",
            "braintrust",
            "--experiment-id",
            "exp-1",
            "--scorer",
            "ExactMatch",
            "--model",
            "candidate",
            "--history",
            str(history),
            "--task",
            "technographics",
        ]
    )

    assert code == 0
    assert fake.urls == ["https://api.braintrust.dev/v1/experiment/exp-1/fetch"]
    [entry] = History(history).runs()
    assert entry.model == "candidate"


def test_import_braintrust_without_a_scorer_names_the_choices(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "import",
            "braintrust",
            str(FIXTURES / "braintrust_experiment.jsonl"),
            "--history",
            str(tmp_path / "runs.jsonl"),
            "--task",
            "t",
        ]
    )

    assert code == 1
    assert "ExactMatch, Factuality" in capsys.readouterr().err
