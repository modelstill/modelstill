import email.message
import io
import json
import urllib.error
import urllib.request

import pytest

from modelstill.client import ChatClient, ChatError


class Opener:
    def __init__(self, reply: dict | None = None, status: int = 200) -> None:
        self.reply = reply or {}
        self.status = status
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        if self.status != 200:
            raise urllib.error.HTTPError(
                request.full_url,
                self.status,
                "error",
                email.message.Message(),
                io.BytesIO(b'{"error": "budget"}'),
            )
        return io.BytesIO(json.dumps(self.reply).encode())


REPLY = {
    "model": "deepseek/deepseek-v4.1-flash",
    "choices": [
        {
            "message": {"content": '{"technologies": []}'},
            "logprobs": {"content": [{"logprob": -0.1}, {"logprob": -0.3}]},
        }
    ],
    "usage": {"prompt_tokens": 1200, "completion_tokens": 40},
}


def test_posts_an_openai_chat_request_with_the_key() -> None:
    opener = Opener(REPLY)
    client = ChatClient("http://127.0.0.1:14100", api_key="sk-test", opener=opener)

    client.chat("technographics", [{"role": "user", "content": "hi"}], temperature=0)

    request = opener.requests[0]
    assert request.full_url == "http://127.0.0.1:14100/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer sk-test"
    assert isinstance(request.data, bytes)
    body = json.loads(request.data)
    assert body["model"] == "technographics"
    assert body["temperature"] == 0


def test_returns_text_model_usage_and_mean_logprob() -> None:
    reply = ChatClient("http://x", api_key="k", opener=Opener(REPLY)).chat("m", [])

    assert reply.text == '{"technologies": []}'
    assert reply.model == "deepseek/deepseek-v4.1-flash"
    assert reply.prompt_tokens == 1200
    assert reply.completion_tokens == 40
    assert reply.mean_logprob == pytest.approx(-0.2)


def test_keeps_the_raw_response_body_so_a_gateway_can_return_it_unchanged() -> None:
    reply = ChatClient("http://x", api_key="k", opener=Opener(REPLY)).chat("m", [])

    assert reply.raw == REPLY


def test_reports_http_errors_with_status_and_body() -> None:
    client = ChatClient("http://x", api_key="k", opener=Opener(status=400))

    with pytest.raises(ChatError, match="400.*budget"):
        client.chat("m", [])


def test_as_complete_plugs_into_an_llm_judge() -> None:
    complete = ChatClient("http://x", api_key="k", opener=Opener(REPLY)).as_complete()

    assert complete("m", [{"role": "user", "content": "x"}]) == '{"technologies": []}'
