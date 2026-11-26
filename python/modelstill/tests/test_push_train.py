import json
import os
from pathlib import Path

import pytest
from test_push import Recorder

from modelstill import push
from modelstill.cli import main
from modelstill.push import PushClient, metric_points, train_run_payload
from modelstill.train import Manifest, TrainedArtifact

MANIFEST = Manifest(
    snapshot="9256c08a" + "0" * 56,
    plan={"task": "technographics", "method": "lora", "seed": 1},
    data={"train": "t", "val": "v"},
    libraries={"trl": "1.18.2"},
    python="3.12.8",
)

HISTORY = [
    {"loss": 1.4, "grad_norm": 3.2, "learning_rate": 0.0002, "epoch": 0.1, "step": 10},
    {"eval_loss": 0.9, "eval_reward": 0.71, "eval_runtime": 2.5, "epoch": 0.2, "step": 20},
    {"loss": 1.1, "grad_norm": float("nan"), "epoch": 0.2, "step": 20, "note": "x", "flag": True},
    {"train_runtime": 120.0, "step": 30},
    {"epoch": 0.3},
]


def make_artifact(root: Path, *, attestation: bool = True, history: bool = True) -> Path:
    path = root / "technographics" / "9256c08a-a41fcbab-s1"
    path.mkdir(parents=True)
    TrainedArtifact(
        path=path,
        base="Qwen/Qwen3-4B",
        dtype="bfloat16",
        metrics={"train_loss": 1.2, "eval_loss": 0.9, "train_runtime_s": 120.0},
        manifest=MANIFEST,
    ).write(path)
    if attestation:
        (path / "attestation.json").write_text(json.dumps({"version": 1, "files": {}}))
    if history:
        (path / "log_history.json").write_text(json.dumps(HISTORY))
    os.utime(path / "artifact.json", (1795500000, 1795500000))
    return path


def test_the_client_upserts_a_train_run_under_its_task() -> None:
    recorder = Recorder({"run": {"key": "k"}})
    client = PushClient("http://api.test", token="secret", opener=recorder)

    client.train_run("technographics", "k", {"status": "running"})

    request = recorder.requests[0]
    assert request.full_url == "http://api.test/v1/tasks/technographics/train-runs/k"
    assert request.get_method() == "PUT"


def test_the_client_posts_metric_points_in_batches() -> None:
    recorder = Recorder({"accepted": 2})
    client = PushClient("http://api.test", token="secret", opener=recorder)
    points = [{"step": step, "epoch": None, "name": "loss", "value": 1.0} for step in range(2500)]

    assert client.train_metrics("k", points) == 6

    assert recorder.requests[0].full_url == "http://api.test/v1/train-runs/k/metrics"
    assert [len(body["metrics"]) for body in recorder.bodies()] == [1000, 1000, 500]


def test_the_client_sends_no_request_for_no_points() -> None:
    recorder = Recorder({"accepted": 0})
    client = PushClient("http://api.test", token="secret", opener=recorder)

    assert client.train_metrics("k", []) == 0
    assert recorder.requests == []


def test_metric_points_keep_every_finite_number_at_its_step() -> None:
    points = metric_points(HISTORY)

    assert {"step": 10, "epoch": 0.1, "name": "loss", "value": 1.4} in points
    assert {"step": 20, "epoch": 0.2, "name": "eval_reward", "value": 0.71} in points
    assert {"step": 30, "epoch": None, "name": "train_runtime", "value": 120.0} in points
    names = {point["name"] for point in points}
    assert names == {
        "loss",
        "grad_norm",
        "learning_rate",
        "eval_loss",
        "eval_reward",
        "eval_runtime",
        "train_runtime",
    }
    assert [p for p in points if p["name"] == "grad_norm"] == [
        {"step": 10, "epoch": 0.1, "name": "grad_norm", "value": 3.2}
    ]


def test_a_train_run_payload_reads_the_artifact_and_its_attestation(tmp_path: Path) -> None:
    path = make_artifact(tmp_path)

    key, payload = train_run_payload(path)

    assert key == "technographics-9256c08a-a41fcbab-s1"
    assert payload["base"] == "Qwen/Qwen3-4B"
    assert payload["method"] == "lora"
    assert payload["status"] == "succeeded"
    assert payload["manifest"] == MANIFEST.model_dump(mode="json")
    assert payload["finalMetrics"] == {
        "train_loss": 1.2,
        "eval_loss": 0.9,
        "train_runtime_s": 120.0,
    }
    assert payload["attestation"] == {"version": 1, "files": {}}
    assert payload["finishedAt"] == "2026-11-24T06:00:00+00:00"
    assert payload["startedAt"] == "2026-11-24T05:58:00+00:00"


def test_a_train_run_payload_without_an_attestation_leaves_it_out(tmp_path: Path) -> None:
    _, payload = train_run_payload(make_artifact(tmp_path, attestation=False))

    assert "attestation" not in payload


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder({"run": {"key": "k"}, "accepted": 9})
    monkeypatch.setattr(push, "_default_opener", recorder)
    monkeypatch.setenv("MODELSTILL_API_URL", "http://api.test")
    monkeypatch.setenv("MODELSTILL_API_TOKEN", "secret")
    return recorder


def test_cli_pushes_a_finished_artifact_and_its_log_history(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = make_artifact(tmp_path)

    assert main(["push", "train", str(path), "--task", "technographics"]) == 0

    key = "technographics-9256c08a-a41fcbab-s1"
    urls = [request.full_url for request in recorder.requests]
    assert urls == [
        f"http://api.test/v1/tasks/technographics/train-runs/{key}",
        f"http://api.test/v1/train-runs/{key}/metrics",
    ]
    run_body, metrics_body = recorder.bodies()
    assert run_body["status"] == "succeeded"
    assert len(metrics_body["metrics"]) == len(metric_points(HISTORY))
    out = capsys.readouterr().out
    assert key in out
    assert f"{len(metric_points(HISTORY))} metric points" in out


def test_cli_pushes_an_artifact_without_log_history(tmp_path: Path, recorder: Recorder) -> None:
    path = make_artifact(tmp_path, history=False)

    assert main(["push", "train", str(path), "--task", "technographics"]) == 0

    assert len(recorder.requests) == 1


def test_cli_reports_a_directory_that_is_not_an_artifact(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["push", "train", str(tmp_path), "--task", "technographics"]) == 1

    assert "artifact.json" in capsys.readouterr().err
    assert recorder.requests == []
