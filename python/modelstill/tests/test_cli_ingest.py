import io
import json
import urllib.request
from pathlib import Path
from typing import IO, Any

import pytest

from modelstill import cli
from modelstill.cli import main
from modelstill.data import DatasetStore
from modelstill.ingest.langfuse import LangfuseReader

MESSAGES = [{"role": "user", "content": "Tools: Python"}]


def test_ingest_jsonl_writes_a_dataset(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    source = tmp_path / "logs.jsonl"
    source.write_text(
        "".join(
            json.dumps({"id": i, "q": f"text {i % 2}", "a": f"answer {i}", "m": f"model-{i}"})
            + "\n"
            for i in range(3)
        )
    )
    out = tmp_path / "dataset.jsonl"

    code = main(
        [
            "ingest",
            "jsonl",
            str(source),
            "--input",
            "q",
            "--output",
            "a",
            "--model-field",
            "m",
            "--id-field",
            "id",
            "--out",
            str(out),
        ]
    )

    assert code == 0
    items = DatasetStore(out).load()
    assert len(items) == 2
    assert {name for item in items for name in item.outputs} == {"model-0", "model-1", "model-2"}
    assert "read 3 records from jsonl into 2 items; 2 new or changed" in capsys.readouterr().out


def test_ingest_jsonl_rejects_two_model_sources(tmp_path: Path) -> None:
    source = tmp_path / "logs.jsonl"
    source.write_text("{}\n")

    code = main(
        [
            "ingest",
            "jsonl",
            str(source),
            "--input",
            "q",
            "--output",
            "a",
            "--model-field",
            "m",
            "--model",
            "x",
            "--out",
            str(tmp_path / "d.jsonl"),
        ]
    )

    assert code == 1


def test_ingest_litellm_and_otel_files(tmp_path: Path) -> None:
    logs = tmp_path / "spend.json"
    logs.write_text(
        json.dumps(
            [
                {
                    "request_id": "r1",
                    "model": "gpt-5-mini",
                    "status": "success",
                    "proxy_server_request": {"messages": MESSAGES},
                    "response": {"choices": [{"message": {"content": "python"}}]},
                }
            ]
        )
    )
    spans = tmp_path / "traces.json"
    span = {
        "traceId": "t",
        "spanId": "s",
        "name": "chat",
        "attributes": [
            {"key": "gen_ai.request.model", "value": {"stringValue": "qwen3-4b"}},
            {"key": "gen_ai.input.messages", "value": {"stringValue": json.dumps(MESSAGES)}},
            {
                "key": "gen_ai.output.messages",
                "value": {"stringValue": json.dumps([{"role": "assistant", "content": "py"}])},
            },
        ],
    }
    spans.write_text(json.dumps({"resourceSpans": [{"scopeSpans": [{"spans": [span]}]}]}))
    out = tmp_path / "dataset.jsonl"

    assert main(["ingest", "litellm", str(logs), "--out", str(out)]) == 0
    assert main(["ingest", "otel", str(spans), "--out", str(out)]) == 0

    [item] = DatasetStore(out).load()
    assert {name: o.output for name, o in item.outputs.items()} == {
        "gpt-5-mini": "python",
        "qwen3-4b": "py",
    }
    assert item.provenance.source == "litellm"


class FakeLangfuse:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> IO[bytes]:
        self.urls.append(request.full_url)
        row = {
            "id": "o1",
            "traceId": "t1",
            "type": "GENERATION",
            "name": "technographics",
            "model": "gpt-5-mini",
            "input": json.dumps(MESSAGES),
            "output": json.dumps({"role": "assistant", "content": "python"}),
        }
        return io.BytesIO(json.dumps({"data": [row], "meta": {}}).encode())


def test_ingest_langfuse_reads_keys_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLangfuse()
    made: list[dict[str, Any]] = []

    def reader(host: str, public_key: str, secret_key: str, **options: Any) -> LangfuseReader:
        made.append({"host": host, "public": public_key, "secret": secret_key, **options})
        return LangfuseReader(host, public_key, secret_key, opener=fake, **options)

    monkeypatch.setattr(cli, "LangfuseReader", reader)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf")
    monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.internal")
    out = tmp_path / "dataset.jsonl"

    code = main(
        [
            "ingest",
            "langfuse",
            "--from",
            "2026-11-01T00:00:00Z",
            "--to",
            "2026-11-24T00:00:00Z",
            "--name",
            "technographics",
            "--out",
            str(out),
        ]
    )

    assert code == 0
    assert made == [
        {"host": "https://langfuse.internal", "public": "pk-lf", "secret": "sk-lf", "api": "v2"}
    ]
    assert "name=technographics" in fake.urls[0]
    [item] = DatasetStore(out).load()
    assert item.outputs["gpt-5-mini"].output == "python"


def test_ingest_langfuse_needs_its_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    code = main(["ingest", "langfuse", "--from", "2026-11-01", "--out", str(tmp_path / "d.jsonl")])

    assert code == 1
