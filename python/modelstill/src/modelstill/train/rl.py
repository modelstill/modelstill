import importlib
import json
from collections.abc import Callable, Sequence
from typing import Any

from modelstill.monitor.canary import Plugin, resolve
from modelstill.train import ChatRow, RlSettings

__all__ = ["environment_factory", "reward_function", "to_rl_row"]

Reward = Callable[..., list[float]]


def to_rl_row(row: ChatRow) -> dict[str, Any]:
    messages = [message.model_dump() for message in row.messages]
    return {"prompt": messages[:-1], "reference": messages[-1]["content"]}


def _text(completion: Any) -> str:
    if isinstance(completion, str):
        return completion
    return str(completion[-1]["content"]) if completion else ""


def _exact(output: str, reference: str) -> float:
    return 1.0 if output.strip() == reference.strip() else 0.0


def _json_equal(output: str, reference: str) -> float:
    try:
        return 1.0 if json.loads(output) == json.loads(reference) else 0.0
    except json.JSONDecodeError:
        return 0.0


_BUILTINS: dict[str, Callable[[str, str], float]] = {
    "exact_match": _exact,
    "json_equal": _json_equal,
}


def reward_function(rl: RlSettings) -> Reward:
    metric = _BUILTINS.get(rl.reward) or resolve(
        Plugin(ref=rl.reward, args=rl.reward_args), "metric"
    )

    def reward(completions: Sequence[Any], reference: Sequence[str], **_: Any) -> list[float]:
        return [
            float(metric(_text(done), expected))
            for done, expected in zip(completions, reference, strict=True)
        ]

    reward.__name__ = rl.reward.rsplit(":", 1)[-1]
    return reward


def environment_factory(rl: RlSettings) -> Any:
    if rl.environment is None:
        return None
    module, _, attribute = rl.environment.partition(":")
    if not attribute:
        raise ValueError(f"environment {rl.environment!r} must be module:attribute")
    return getattr(importlib.import_module(module), attribute)
