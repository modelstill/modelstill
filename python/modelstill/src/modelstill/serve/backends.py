import asyncio
import math
from collections.abc import Callable
from typing import Any, Protocol

from modelstill.client import ChatReply
from modelstill.serve.router import Answer, Model


class Chat(Protocol):
    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply: ...


Confidence = Callable[[ChatReply], float | None]


def exp_mean_logprob(reply: ChatReply) -> float | None:
    return None if reply.mean_logprob is None else math.exp(reply.mean_logprob)


def _token_logprobs(reply: ChatReply) -> list[float]:
    choices = reply.raw.get("choices") or [{}]
    tokens = (choices[0].get("logprobs") or {}).get("content") or []
    return [float(token["logprob"]) for token in tokens]


def min_token_prob(reply: ChatReply) -> float | None:
    values = _token_logprobs(reply)
    return math.exp(min(values)) if values else None


_DROPPED = frozenset({"model", "messages", "stream", "stream_options"})


def openai_backend(
    client: Chat,
    model: str | Callable[[], str],
    logprobs: bool,
    confidence: Confidence | None = exp_mean_logprob,
) -> Model:
    async def call(request: dict) -> Answer:
        name = model() if callable(model) else model
        params = {key: value for key, value in request.items() if key not in _DROPPED}
        if logprobs:
            params["logprobs"] = True
        reply = await asyncio.to_thread(client.chat, name, request["messages"], **params)
        return Answer(
            text=reply.text,
            model=reply.model,
            confidence=confidence(reply) if confidence is not None else None,
            raw=reply.raw,
        )

    return call
