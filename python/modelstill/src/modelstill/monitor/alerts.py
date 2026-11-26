import json
import logging
import os
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import IO, Any, Literal, Protocol

Opener = Callable[[urllib.request.Request, float], IO[bytes]]
Level = Literal["info", "warn", "critical"]

_DISCORD_LIMIT = 2000


@dataclass(frozen=True)
class Alert:
    kind: str
    task: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)
    level: Level = "warn"


class AlertSink(Protocol):
    def send(self, alert: Alert) -> None: ...


class LogAlertSink:
    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._logger = logger or logging.getLogger("modelstill.alerts")

    def send(self, alert: Alert) -> None:
        self._logger.warning(
            "ALERT %s %s %s: %s %s",
            alert.level,
            alert.kind,
            alert.task,
            alert.message,
            json.dumps(alert.details, default=str),
        )


def _default_opener(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class DiscordAlertSink:
    def __init__(
        self,
        env: str = "MODELSTILL_DISCORD_WEBHOOK",
        environ: Mapping[str, str] = os.environ,
        opener: Opener = _default_opener,
        timeout: float = 10.0,
    ) -> None:
        url = environ.get(env)
        if not url:
            raise ValueError(f"environment variable {env} holds no Discord webhook URL")
        self._url = url
        self._opener = opener
        self._timeout = timeout

    def send(self, alert: Alert) -> None:
        details = json.dumps(alert.details, default=str)
        content = (
            f"[{alert.level}] **{alert.kind}** `{alert.task}`: {alert.message}\n```{details}```"
        )
        if len(content) > _DISCORD_LIMIT:
            content = content[: _DISCORD_LIMIT - 1] + "…"
        request = urllib.request.Request(
            self._url,
            data=json.dumps({"content": content}).encode(),
            headers={"Content-Type": "application/json", "User-Agent": "modelstill"},
            method="POST",
        )
        with self._opener(request, self._timeout):
            pass
