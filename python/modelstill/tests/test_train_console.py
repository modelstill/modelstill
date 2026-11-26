import json
import urllib.error
import urllib.request
from typing import Any

import pytest

from modelstill.push import PushClient
from modelstill.train.console import ConsoleReporter, console_from_env


class FakeApi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.down = False

    def __call__(self, request: urllib.request.Request, timeout: float) -> Any:
        if self.down:
            raise urllib.error.URLError("connection refused")
        assert isinstance(request.data, bytes)
        body = json.loads(request.data)
        self.calls.append((request.get_method(), request.full_url, body))
        reply = {"accepted": len(body.get("metrics", []))} if "metrics" in body else {"run": {}}
        return _Reply(reply)

    def metric_batches(self) -> list[list[dict[str, Any]]]:
        return [body["metrics"] for _, _, body in self.calls if "metrics" in body]

    def runs(self) -> list[dict[str, Any]]:
        return [body for method, _, body in self.calls if method == "PUT"]


class _Reply:
    def __init__(self, body: dict[str, Any]) -> None:
        self._data = json.dumps(body).encode()

    def __enter__(self) -> "_Reply":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self, *args: object) -> bytes:
        return self._data


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


KEY = "technographics-9256c08a-a41fcbab-s1"


def reporter(api: FakeApi, clock: Clock | None = None, **options: Any) -> ConsoleReporter:
    client = PushClient("http://api.test", token="secret", opener=api)
    return ConsoleReporter(
        client,
        task="technographics",
        key=KEY,
        base="Qwen/Qwen3-4B",
        method="lora",
        clock=clock or Clock(),
        **options,
    )


def test_start_registers_a_running_run() -> None:
    api = FakeApi()

    assert reporter(api).start(manifest={"snapshot": "9256c08a"}) is True

    method, url, body = api.calls[0]
    assert method == "PUT"
    assert url == f"http://api.test/v1/tasks/technographics/train-runs/{KEY}"
    assert body["status"] == "running"
    assert body["base"] == "Qwen/Qwen3-4B"
    assert body["method"] == "lora"
    assert body["manifest"] == {"snapshot": "9256c08a"}
    assert body["startedAt"].endswith("+00:00")


def test_logs_are_buffered_until_a_batch_is_full() -> None:
    api = FakeApi()
    console = reporter(api, batch_size=4)

    console.on_log(10, 0.1, {"loss": 1.4, "learning_rate": 0.0002})
    assert api.metric_batches() == []
    console.on_log(20, 0.2, {"loss": 1.1, "grad_norm": 2.0, "epoch": 0.2})

    assert api.metric_batches() == [
        [
            {"step": 10, "epoch": 0.1, "name": "loss", "value": 1.4},
            {"step": 10, "epoch": 0.1, "name": "learning_rate", "value": 0.0002},
            {"step": 20, "epoch": 0.2, "name": "loss", "value": 1.1},
            {"step": 20, "epoch": 0.2, "name": "grad_norm", "value": 2.0},
        ]
    ]
    assert console.sent == 4
    assert console.pending == 0


def test_a_quiet_interval_flushes_a_partial_batch() -> None:
    api = FakeApi()
    clock = Clock()
    console = reporter(api, clock, batch_size=100, flush_seconds=10.0)

    console.on_log(10, None, {"loss": 1.4})
    clock.now = 11.0
    console.on_log(20, None, {"loss": 1.2})

    assert [len(batch) for batch in api.metric_batches()] == [2]


def test_non_numeric_and_non_finite_values_are_skipped() -> None:
    api = FakeApi()
    console = reporter(api, batch_size=1)

    logs: dict[str, Any] = {"loss": float("inf"), "note": "x", "flag": True, "eval_loss": 0.5}

    console.on_log(5, float("nan"), logs)

    assert api.metric_batches() == [[{"step": 5, "epoch": None, "name": "eval_loss", "value": 0.5}]]


def test_a_down_api_never_raises_and_the_points_are_retried() -> None:
    api = FakeApi()
    console = reporter(api, batch_size=1)
    api.down = True

    assert console.start() is False
    console.on_log(10, 0.1, {"loss": 1.4})
    console.on_log(20, 0.2, {"loss": 1.2})

    assert console.failures == 3
    assert console.pending == 2
    api.down = False
    console.on_log(30, 0.3, {"loss": 1.0})
    assert [len(batch) for batch in api.metric_batches()] == [3]
    assert console.pending == 0


def test_the_buffer_is_capped_and_drops_the_oldest_points() -> None:
    api = FakeApi()
    console = reporter(api, batch_size=1, max_pending=3)
    api.down = True

    for step in range(5):
        console.on_log(step, None, {"loss": float(step)})

    assert console.pending == 3
    assert console.dropped == 2
    api.down = False
    console.flush()
    assert [point["step"] for point in api.metric_batches()[0]] == [2, 3, 4]


def test_finish_flushes_and_records_the_status_and_final_metrics() -> None:
    api = FakeApi()
    console = reporter(api, batch_size=100)
    console.start()
    console.on_log(10, 0.1, {"loss": 1.4})

    assert console.finish("succeeded", {"eval_loss": 0.42, "steps": 10.0}) is True

    assert api.metric_batches() == [[{"step": 10, "epoch": 0.1, "name": "loss", "value": 1.4}]]
    final = api.runs()[-1]
    assert final["status"] == "succeeded"
    assert final["finalMetrics"] == {"eval_loss": 0.42, "steps": 10.0}
    assert final["finishedAt"].endswith("+00:00")


def test_finish_on_a_down_api_returns_false() -> None:
    api = FakeApi()
    console = reporter(api)
    api.down = True

    assert console.finish("failed") is False
    assert console.failures == 1


def test_from_env_needs_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MODELSTILL_API_TOKEN", raising=False)

    assert console_from_env("t", KEY, "base", "lora") is None


def test_from_env_reads_the_api_url_and_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODELSTILL_API_TOKEN", "secret")
    monkeypatch.setenv("MODELSTILL_API_URL", "http://api.test")

    console = console_from_env("t", KEY, "base", "lora")

    assert isinstance(console, ConsoleReporter)
    assert console.key == KEY
    assert console.task == "t"
