from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fake_api import FakeApi

from modelstill.monitor.alerts import Alert
from modelstill.monitor.api_sink import ApiMonitorSink, api_sink_from
from modelstill.monitor.canary import CANARY_RESULTS, CANARY_RUNS
from modelstill.monitor.watch import WATCH_RUNS
from modelstill.push import PushClient

NOW = datetime(2026, 11, 25, 10, 0, 0, tzinfo=UTC)
RUN_ID = "43f6386472184191b3c94358de47ede8"


def sink(tmp_path: Path, api: FakeApi) -> ApiMonitorSink:
    client = PushClient("http://api.test", token="secret", opener=api)
    return ApiMonitorSink(client, "qa", tmp_path / "state", clock=lambda: NOW)


def canary_summary(**changes: Any) -> dict[str, Any]:
    return {
        "ts": "2026-11-25 09:30:00.123",
        "run_id": RUN_ID,
        "task": "qa",
        "provider": "openai/gpt-x",
        "items": 20,
        "passed": 18,
        "low": 0.683,
        "high": 0.988,
        **changes,
    }


def test_a_canary_run_is_posted_as_a_canary_record(tmp_path: Path) -> None:
    api = FakeApi()
    monitor = sink(tmp_path, api)

    monitor.write(CANARY_RUNS, [canary_summary()])
    monitor.write(CANARY_RESULTS, [{"pass": True}])
    result = monitor.flush()

    assert api.calls() == [
        (
            "POST",
            "/v1/tasks/qa/canaries",
            {
                "runs": [
                    {
                        "id": RUN_ID,
                        "createdAt": "2026-11-25T09:30:00.123000+00:00",
                        "provider": "openai/gpt-x",
                        "passed": 18,
                        "total": 20,
                        "low": 0.683,
                        "high": 0.988,
                    }
                ]
            },
        )
    ]
    assert result.sent == 1 and result.error is None


def test_alerts_go_out_in_one_batch_with_their_level_as_severity(tmp_path: Path) -> None:
    api = FakeApi()
    monitor = sink(tmp_path, api)

    monitor.send(Alert("canary_below_floor", "qa", "below", {"floor": 0.9}, level="critical"))
    monitor.send(Alert("provider_drift", "qa", "changed", {"changed": ["c1"]}))
    monitor.flush()

    [(method, path, body)] = api.calls()
    assert (method, path) == ("POST", "/v1/tasks/qa/alerts")
    first, second = body["alerts"]
    assert first["kind"] == "canary_below_floor" and first["severity"] == "critical"
    assert first["payload"] == {"message": "below", "details": {"floor": 0.9}}
    assert first["createdAt"] == NOW.isoformat()
    assert second["severity"] == "warn"
    assert first["id"] != second["id"]


def test_a_watch_check_with_a_canary_is_a_canary_record_and_one_without_is_not(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    monitor = sink(tmp_path, api)
    with_canary = {
        "ts": "2026-11-25 09:30:00.000",
        "run_id": RUN_ID,
        "provider": "p",
        "canary_items": 10,
        "canary_passed": 9,
        "canary_low": 0.55,
        "canary_high": 0.99,
    }

    monitor.write(WATCH_RUNS, [with_canary, {**with_canary, "canary_items": None}])
    monitor.flush()

    [(_, path, body)] = api.calls()
    assert path == "/v1/tasks/qa/canaries"
    assert [(run["passed"], run["total"]) for run in body["runs"]] == [(9, 10)]


def test_nothing_to_send_sends_nothing(tmp_path: Path) -> None:
    api = FakeApi()

    assert sink(tmp_path, api).flush().sent == 0
    assert api.requests == []


def test_a_failed_push_never_raises_and_is_resent_by_the_next_run(tmp_path: Path) -> None:
    down = FakeApi(status=503)
    failing = sink(tmp_path, down)
    failing.write(CANARY_RUNS, [canary_summary()])
    failing.send(Alert("canary_below_floor", "qa", "below", level="critical"))

    result = failing.flush()

    assert result.sent == 0 and result.kept == 2
    assert result.error is not None and "503" in result.error
    up = FakeApi()
    resent = sink(tmp_path, up).flush()
    assert resent.sent == 2 and resent.kept == 0
    assert sorted(path for _, path, _ in up.calls()) == [
        "/v1/tasks/qa/alerts",
        "/v1/tasks/qa/canaries",
    ]
    assert sink(tmp_path, FakeApi()).flush().sent == 0


def test_the_outbox_keeps_only_the_newest_records(tmp_path: Path) -> None:
    client = PushClient("http://api.test", token="secret", opener=FakeApi(status=503))
    monitor = ApiMonitorSink(client, "qa", tmp_path, clock=lambda: NOW, max_outbox=3)
    for index in range(5):
        monitor.send(Alert(f"kind{index}", "qa", "m"))

    assert monitor.flush().kept == 3

    up = FakeApi()
    resent = ApiMonitorSink(
        PushClient("http://api.test", token="secret", opener=up), "qa", tmp_path, clock=lambda: NOW
    ).flush()
    assert resent.sent == 3
    [(_, _, body)] = up.calls()
    assert [alert["kind"] for alert in body["alerts"]] == ["kind2", "kind3", "kind4"]


def test_rollback_sets_the_api_deployment_off_and_keeps_the_rest(tmp_path: Path) -> None:
    record = {
        "mode": "serve",
        "studentModel": "qa-v1",
        "threshold": 0.9,
        "targetError": 0.05,
        "shadowSample": 0.2,
        "activeFrom": "2026-11-20T00:00:00.000Z",
    }
    api = FakeApi(deployment=record)

    assert sink(tmp_path, api).rollback() == "set the API deployment of qa to mode off"

    (get_method, get_path, _), (put_method, put_path, body) = api.calls()
    assert (get_method, get_path) == ("GET", "/v1/tasks/qa/deployment")
    assert (put_method, put_path) == ("PUT", "/v1/tasks/qa/deployment")
    assert body == {
        "mode": "off",
        "studentModel": "qa-v1",
        "threshold": 0.9,
        "targetError": 0.05,
        "shadowSample": 0.2,
    }


def test_rollback_without_an_api_deployment_changes_nothing(tmp_path: Path) -> None:
    api = FakeApi(deployment=None)

    assert "no deployment" in sink(tmp_path, api).rollback()
    assert [method for method, _, _ in api.calls()] == ["GET"]


def test_rollback_reports_an_unreachable_api_instead_of_raising(tmp_path: Path) -> None:
    assert "503" in sink(tmp_path, FakeApi(status=503)).rollback()


def test_the_sink_is_on_only_with_a_url_and_token_or_an_explicit_url(tmp_path: Path) -> None:
    both = {"MODELSTILL_API_URL": "http://api.test", "MODELSTILL_API_TOKEN": "t"}

    assert api_sink_from("qa", tmp_path, environ={}) is None
    assert api_sink_from("qa", tmp_path, environ={"MODELSTILL_API_TOKEN": "t"}) is None
    assert api_sink_from("qa", tmp_path, environ=both) is not None
    assert api_sink_from("qa", tmp_path, environ=both, disabled=True) is None
    explicit = api_sink_from("qa", tmp_path, url="http://x", environ={"MODELSTILL_API_TOKEN": "t"})
    assert explicit is not None
    with pytest.raises(ValueError, match="MODELSTILL_API_TOKEN"):
        api_sink_from("qa", tmp_path, url="http://x", environ={})
