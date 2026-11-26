import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, Protocol

from modelstill.client import ChatReply

__all__ = ["sample"]


class _Chat(Protocol):
    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply: ...


def sample(
    client: _Chat,
    model: str,
    prompts: Iterable[Mapping[str, Any]],
    out: Path,
    top_logprobs: int,
    temperature: float,
    max_tokens: int | None = None,
) -> int:
    params: dict[str, Any] = {"logprobs": True}
    if top_logprobs:
        params["top_logprobs"] = top_logprobs
    params["temperature"] = temperature
    if max_tokens is not None:
        params["max_tokens"] = max_tokens
    count = 0
    with out.open("w") as stream:
        for prompt in prompts:
            reply = client.chat(model, list(prompt["messages"]), **params)
            row: dict[str, Any] = {
                "text": reply.text,
                "model": reply.model,
                "prompt_tokens": reply.prompt_tokens,
                "completion_tokens": reply.completion_tokens,
                "mean_logprob": reply.mean_logprob,
            }
            if top_logprobs:
                choices = reply.raw.get("choices") or [{}]
                row["tokens"] = (choices[0].get("logprobs") or {}).get("content") or []
            stream.write(json.dumps(row) + "\n")
            count += 1
    return count
