import io
import json
import logging
import urllib.request

import pytest

from modelstill.monitor.alerts import Alert, DiscordAlertSink, LogAlertSink

ALERT = Alert(
    kind="canary_below_floor",
    task="technographics",
    message="pass rate 0.40 [0.12, 0.74] is below the floor 0.80",
    details={"passed": 4, "total": 10},
)


class Opener:
    def __init__(self) -> None:
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        return io.BytesIO(b"")


def test_the_log_sink_writes_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="modelstill.alerts"):
        LogAlertSink().send(ALERT)

    assert "canary_below_floor" in caplog.text
    assert "technographics" in caplog.text


def test_discord_posts_the_alert_to_the_webhook_named_by_the_environment() -> None:
    opener = Opener()
    sink = DiscordAlertSink(
        env="TEST_WEBHOOK",
        environ={"TEST_WEBHOOK": "https://discord.test/api/webhooks/1/x"},
        opener=opener,
    )

    sink.send(ALERT)

    request = opener.requests[0]
    assert request.full_url == "https://discord.test/api/webhooks/1/x"
    assert isinstance(request.data, bytes)
    content = json.loads(request.data)["content"]
    assert "canary_below_floor" in content and "pass rate 0.40" in content


def test_discord_without_the_variable_set_fails_at_construction() -> None:
    with pytest.raises(ValueError, match="TEST_WEBHOOK"):
        DiscordAlertSink(env="TEST_WEBHOOK", environ={}, opener=Opener())


def test_discord_messages_fit_the_2000_character_limit() -> None:
    opener = Opener()
    sink = DiscordAlertSink(env="W", environ={"W": "https://d.test/w"}, opener=opener)

    sink.send(Alert("k", "t", "x" * 5000, {}))

    assert isinstance(opener.requests[0].data, bytes)
    assert len(json.loads(opener.requests[0].data)["content"]) <= 2000


def test_alerts_default_to_warn_and_sinks_show_the_level(caplog: pytest.LogCaptureFixture) -> None:
    opener = Opener()
    sink = DiscordAlertSink(env="W", environ={"W": "https://d.test/w"}, opener=opener)
    critical = Alert("watch_logprob_shift", "qa", "shifted", {}, level="critical")

    sink.send(critical)
    with caplog.at_level(logging.WARNING, logger="modelstill.alerts"):
        LogAlertSink().send(critical)

    assert ALERT.level == "warn"
    assert isinstance(opener.requests[0].data, bytes)
    assert "critical" in json.loads(opener.requests[0].data)["content"]
    assert "critical" in caplog.text
