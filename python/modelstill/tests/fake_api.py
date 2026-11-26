import email.message
import io
import json
import urllib.error
import urllib.request
from typing import Any


class FakeApi:
    def __init__(self, status: int = 200, deployment: dict[str, Any] | None = None) -> None:
        self.status = status
        self.deployment = deployment
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        if self.status >= 400:
            raise urllib.error.HTTPError(
                request.full_url, self.status, "error", email.message.Message(), io.BytesIO(b"{}")
            )
        if request.full_url.endswith("/deployment"):
            return io.BytesIO(json.dumps({"deployment": self.deployment}).encode())
        body = json.loads(request.data) if isinstance(request.data, bytes) else {}
        return io.BytesIO(json.dumps({"recorded": len(next(iter(body.values()), []))}).encode())

    def calls(self) -> list[tuple[str, str, Any]]:
        return [
            (
                request.get_method(),
                request.full_url.removeprefix("http://api.test"),
                json.loads(request.data) if isinstance(request.data, bytes) else None,
            )
            for request in self.requests
        ]
