import json
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from statistics import fmean
from typing import IO, Any

Opener = Callable[[urllib.request.Request, float], IO[bytes]]


class ChatError(Exception):
    pass


@dataclass(frozen=True)
class ChatReply:
    text: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    mean_logprob: float | None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


def _default_opener(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class ChatClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 120.0,
        opener: Opener = _default_opener,
    ) -> None:
        self._url = base_url.rstrip("/") + "/v1/chat/completions"
        self._key = api_key
        self._timeout = timeout
        self._opener = opener

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        request = urllib.request.Request(
            self._url,
            data=json.dumps({"model": model, "messages": messages, **params}).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._key}",
            },
            method="POST",
        )
        try:
            with self._opener(request, self._timeout) as response:
                body = json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            raise ChatError(f"{error.code}: {detail}") from error
        choice = body["choices"][0]
        tokens = ((choice.get("logprobs") or {}).get("content")) or []
        usage = body.get("usage") or {}
        return ChatReply(
            text=choice["message"].get("content") or "",
            model=body.get("model", model),
            prompt_tokens=int(usage.get("prompt_tokens", 0)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
            mean_logprob=fmean(token["logprob"] for token in tokens) if tokens else None,
            raw=body,
        )

    def as_complete(self, **params: Any) -> Callable[[str, list[dict[str, str]]], str]:
        return lambda model, messages: self.chat(model, messages, **params).text
