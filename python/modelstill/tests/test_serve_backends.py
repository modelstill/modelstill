import math
from typing import Any

import pytest

from modelstill.client import ChatReply
from modelstill.serve.backends import exp_mean_logprob, min_token_prob, openai_backend


class FakeChat:
    def __init__(self, reply: ChatReply) -> None:
        self.reply = reply
        self.calls: list[tuple[str, list[dict[str, str]], dict[str, Any]]] = []

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        self.calls.append((model, messages, params))
        return self.reply


RAW = {
    "model": "technographics-v1-s1",
    "choices": [
        {
            "message": {"content": "{}"},
            "logprobs": {"content": [{"logprob": -0.1}, {"logprob": -0.5}]},
        }
    ],
}
REPLY = ChatReply("{}", "technographics-v1-s1", 10, 2, -0.3, raw=RAW)
REQUEST = {
    "model": "technographics",
    "messages": [{"role": "user", "content": "Python"}],
    "temperature": 0,
    "stream": False,
}


async def test_the_student_is_asked_for_logprobs_under_the_deployed_model_name() -> None:
    chat = FakeChat(REPLY)
    backend = openai_backend(chat, model=lambda: "technographics-v1-s1", logprobs=True)

    await backend(REQUEST)

    model, messages, params = chat.calls[0]
    assert model == "technographics-v1-s1"
    assert messages == REQUEST["messages"]
    assert params == {"temperature": 0, "logprobs": True}


async def test_default_confidence_is_the_geometric_mean_token_probability() -> None:
    backend = openai_backend(FakeChat(REPLY), model="s", logprobs=True)

    answer = await backend(REQUEST)

    assert answer.confidence == pytest.approx(math.exp(-0.3))
    assert answer.model == "technographics-v1-s1"
    assert answer.raw == RAW


async def test_confidence_is_pluggable() -> None:
    backend = openai_backend(FakeChat(REPLY), model="s", logprobs=True, confidence=min_token_prob)

    answer = await backend(REQUEST)

    assert answer.confidence == pytest.approx(math.exp(-0.5))


async def test_the_cloud_is_called_under_its_alias_without_logprobs() -> None:
    chat = FakeChat(REPLY)
    backend = openai_backend(chat, model="technographics", logprobs=False, confidence=None)

    answer = await backend(REQUEST)

    assert chat.calls[0][0] == "technographics"
    assert "logprobs" not in chat.calls[0][2]
    assert answer.confidence is None


def test_no_logprobs_means_no_confidence() -> None:
    assert exp_mean_logprob(ChatReply("x", "m", 1, 1, None)) is None
    assert min_token_prob(ChatReply("x", "m", 1, 1, None)) is None
