import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from fake_api import FakeApi
from fake_openai import FakeOpenAI

from modelstill import push
from modelstill.cli import main


def answer_question(body: dict[str, Any]) -> str:
    return body["messages"][-1]["content"].replace("question", "answer")


def write_config(tmp_path: Path, url: str, floor: float, **extra: Any) -> Path:
    (tmp_path / "canary.jsonl").write_text(
        "".join(
            json.dumps({"id": f"c{i}", "input": f"question {i}", "expected": f"answer {i}"}) + "\n"
            for i in range(10)
        )
    )
    path = tmp_path / "monitor.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "task": "qa",
                "target": {"base_url": url, "model": "qa-alias"},
                "state_dir": "state",
                "canary": {"benchmark": "canary.jsonl", "floor": floor},
                "drift": {"prompts": "canary.jsonl", "limit": 5},
                **extra,
            }
        )
    )
    return path


def test_canary_prints_the_result_and_keeps_local_rows(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with FakeOpenAI("qa-alias", answer_question) as fake:
        code = main(["monitor", "canary", str(write_config(tmp_path, fake.url, floor=0.5))])

    assert code == 0
    result = json.loads(capsys.readouterr().out)
    assert result["passed"] == 10 and result["items"] == 10
    assert result["low"] == pytest.approx(0.6915029)
    assert result["alerts"] == []
    rows = (tmp_path / "state" / "modelstill.canary_results.jsonl").read_text().splitlines()
    assert len(rows) == 10


def test_canary_exits_2_on_an_alert_when_asked_to(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with FakeOpenAI("qa-alias", lambda body: "no idea") as fake:
        config = write_config(tmp_path, fake.url, floor=0.5)
        code = main(["monitor", "canary", str(config), "--fail-on-alert"])

    assert code == 2
    assert json.loads(capsys.readouterr().out)["alerts"] == ["canary_below_floor"]


def test_a_configured_but_unset_discord_variable_fails_before_any_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("MODELSTILL_TEST_WEBHOOK", raising=False)
    with FakeOpenAI("qa-alias", answer_question) as fake:
        config = write_config(
            tmp_path, fake.url, floor=0.5, alerts={"discord_env": "MODELSTILL_TEST_WEBHOOK"}
        )
        code = main(["monitor", "canary", str(config)])
        assert fake.requests == []

    assert code == 1


def test_drift_reports_the_fingerprint_and_changes(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with FakeOpenAI("qa-alias", answer_question) as fake:
        config = write_config(tmp_path, fake.url, floor=0.5)
        assert main(["monitor", "drift", str(config)]) == 0
        first = json.loads(capsys.readouterr().out)
    with FakeOpenAI("qa-alias", lambda body: "changed") as fake:
        config = write_config(tmp_path, fake.url, floor=0.5)
        assert main(["monitor", "drift", str(config)]) == 0
        second = json.loads(capsys.readouterr().out)

    assert first["previous"] is None and first["answered"] == 5
    assert len(second["changed"]) == 5
    assert second["alerts"] == ["provider_drift"]


def write_watch_config(tmp_path: Path, url: str) -> Path:
    path = write_config(tmp_path, url, floor=0.5)
    config = yaml.safe_load(path.read_text())
    config.pop("drift")
    config["watch"] = {"prompts": "canary.jsonl"}
    watch = tmp_path / "watch.yaml"
    watch.write_text(yaml.safe_dump(config))
    return watch


def test_watch_records_a_baseline_then_checks_against_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with FakeOpenAI("qa-alias", answer_question) as fake:
        config = write_watch_config(tmp_path, fake.url)
        assert main(["watch", "baseline", str(config)]) == 0
        recorded = json.loads(capsys.readouterr().out)
        assert main(["watch", "baseline", str(config)]) == 1
        assert main(["watch", "check", str(config), "--fail-on-alert"]) == 0
        checked = json.loads(capsys.readouterr().out)

    assert recorded["prompts"] == 10 and recorded["canary_passed"] == 10
    assert any(body.get("logprobs") for body in fake.requests)
    assert checked["level"] == "ok"
    assert checked["baseline_run_id"] == recorded["run_id"]


def test_watch_check_exits_2_and_falls_back_on_a_critical_change(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    deployment = tmp_path / "qa.deployment.yaml"
    deployment.write_text(
        yaml.safe_dump(
            {
                "task": "qa",
                "mode": "serve",
                "student_model": "s",
                "threshold": 0.9,
                "shadow_sample": 0.1,
            }
        )
    )
    with FakeOpenAI("qa-alias", answer_question) as fake:
        assert main(["watch", "baseline", str(write_watch_config(tmp_path, fake.url))]) == 0
    capsys.readouterr()
    with FakeOpenAI("qa-alias", lambda body: "no idea") as fake:
        config = write_watch_config(tmp_path, fake.url)
        code = main(
            [
                "watch",
                "check",
                str(config),
                "--fail-on-alert",
                "--fallback-deployment",
                str(deployment),
            ]
        )

    result = json.loads(capsys.readouterr().out)
    assert code == 2
    assert result["level"] == "critical" and result["fallback"] is True
    assert yaml.safe_load(deployment.read_text())["mode"] == "off"


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    fake = FakeApi()
    monkeypatch.setattr(push, "_default_opener", fake)
    monkeypatch.setenv("MODELSTILL_API_URL", "http://api.test")
    monkeypatch.setenv("MODELSTILL_API_TOKEN", "secret")
    return fake


def test_canary_pushes_its_run_and_alerts_to_the_api_when_configured(
    tmp_path: Path, api: FakeApi, capsys: pytest.CaptureFixture[str]
) -> None:
    with FakeOpenAI("qa-alias", lambda body: "no idea") as fake:
        code = main(["monitor", "canary", str(write_config(tmp_path, fake.url, floor=0.5))])

    assert code == 0
    calls = {path: body for _, path, body in api.calls()}
    [run] = calls["/v1/tasks/qa/canaries"]["runs"]
    assert (run["passed"], run["total"], run["provider"]) == (0, 10, "qa-alias")
    [alert] = calls["/v1/tasks/qa/alerts"]["alerts"]
    assert alert["kind"] == "canary_below_floor"
    assert "sent 2 records to the API" in capsys.readouterr().err


def test_an_unreachable_api_never_fails_the_canary_and_keeps_the_records(
    tmp_path: Path, api: FakeApi, capsys: pytest.CaptureFixture[str]
) -> None:
    api.status = 503
    with FakeOpenAI("qa-alias", answer_question) as fake:
        code = main(["monitor", "canary", str(write_config(tmp_path, fake.url, floor=0.5))])

    assert code == 0
    assert json.loads(capsys.readouterr().out)["passed"] == 10
    assert (tmp_path / "state" / "api-outbox.jsonl").exists()


def test_no_api_keeps_the_monitor_local(tmp_path: Path, api: FakeApi) -> None:
    with FakeOpenAI("qa-alias", answer_question) as fake:
        config = write_config(tmp_path, fake.url, floor=0.5)
        assert main(["monitor", "canary", str(config), "--no-api"]) == 0

    assert api.requests == []


def test_an_explicit_api_url_needs_a_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    with FakeOpenAI("qa-alias", answer_question) as fake:
        config = write_config(tmp_path, fake.url, floor=0.5)
        code = main(["monitor", "drift", str(config), "--api", "http://api.test"])
        assert fake.requests == []

    assert code == 1
    assert "MODELSTILL_API_TOKEN" in capsys.readouterr().err


def test_drift_alerts_reach_the_api(tmp_path: Path, api: FakeApi) -> None:
    with FakeOpenAI("qa-alias", answer_question) as fake:
        main(["monitor", "drift", str(write_config(tmp_path, fake.url, floor=0.5))])
    with FakeOpenAI("qa-alias", lambda body: "changed") as fake:
        main(["monitor", "drift", str(write_config(tmp_path, fake.url, floor=0.5))])

    [(_, path, body)] = api.calls()
    assert path == "/v1/tasks/qa/alerts"
    assert body["alerts"][0]["kind"] == "provider_drift"


def test_watch_fallback_also_turns_the_api_deployment_off(
    tmp_path: Path, api: FakeApi, capsys: pytest.CaptureFixture[str]
) -> None:
    api.deployment = {
        "mode": "serve",
        "studentModel": "s",
        "threshold": 0.9,
        "targetError": 0.05,
        "shadowSample": 0.1,
        "activeFrom": "2026-11-20T00:00:00.000Z",
    }
    deployment = tmp_path / "qa.deployment.yaml"
    deployment.write_text(
        yaml.safe_dump(
            {"task": "qa", "mode": "serve", "student_model": "s", "threshold": 0.9}
            | {"shadow_sample": 0.1}
        )
    )
    with FakeOpenAI("qa-alias", answer_question) as fake:
        assert main(["watch", "baseline", str(write_watch_config(tmp_path, fake.url))]) == 0
    with FakeOpenAI("qa-alias", lambda body: "no idea") as fake:
        config = write_watch_config(tmp_path, fake.url)
        code = main(["watch", "check", str(config), "--fallback-deployment", str(deployment)])

    assert code == 0
    puts = [body for method, _, body in api.calls() if method == "PUT"]
    assert puts == [
        {
            "mode": "off",
            "studentModel": "s",
            "threshold": 0.9,
            "targetError": 0.05,
            "shadowSample": 0.1,
        }
    ]
    sent = {path for method, path, _ in api.calls() if method == "POST"}
    assert sent == {"/v1/tasks/qa/canaries", "/v1/tasks/qa/alerts"}
    assert "set the API deployment of qa to mode off" in capsys.readouterr().err
