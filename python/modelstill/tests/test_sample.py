import json
from pathlib import Path
from typing import Any

from modelstill.client import ChatReply
from modelstill.sample import sample

PROMPTS = [
    {"messages": [{"role": "user", "content": "Python"}]},
    {"messages": [{"role": "user", "content": "Go"}]},
]


class Served:
    def __init__(self) -> None:
        self.params: list[dict[str, Any]] = []

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        self.params.append(params)
        tokens = [
            {"token": "a", "logprob": -0.1, "top_logprobs": [{"token": "a", "logprob": -0.1}]}
        ]
        raw = {"choices": [{"logprobs": {"content": tokens}}]}
        return ChatReply(messages[0]["content"].lower(), model, 3, 1, -0.1, raw)


def test_each_prompt_gets_one_row_with_answer_model_and_logprobs(tmp_path: Path) -> None:
    out = tmp_path / "out.jsonl"
    served = Served()

    count = sample(served, "tech-s1", PROMPTS, out, top_logprobs=2, temperature=0.0)

    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert count == 2
    assert [row["text"] for row in rows] == ["python", "go"]
    assert rows[0]["model"] == "tech-s1"
    assert rows[0]["mean_logprob"] == -0.1
    assert rows[0]["tokens"][0]["top_logprobs"][0]["token"] == "a"
    assert served.params[0] == {"logprobs": True, "top_logprobs": 2, "temperature": 0.0}


def test_without_top_logprobs_only_the_mean_is_kept(tmp_path: Path) -> None:
    out = tmp_path / "out.jsonl"

    sample(Served(), "tech-s1", PROMPTS[:1], out, top_logprobs=0, temperature=0.0)

    [row] = [json.loads(line) for line in out.read_text().splitlines()]
    assert "tokens" not in row
    assert row["mean_logprob"] == -0.1
