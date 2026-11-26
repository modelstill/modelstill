import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from modelstill.train import ChatRow, plans_from_spec
from modelstill.train.config import grpo_settings
from modelstill.train.rl import environment_factory, reward_function, to_rl_row

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"


def _plan(tmp_path: Path, **rl: object):
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    [plan] = plans_from_spec(
        REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1], method="grpo",
        rl={"reward": "json_equal", **rl},
    )  # fmt: skip
    return plan


def test_a_grpo_plan_needs_rl_settings_and_only_grpo_has_them(tmp_path: Path) -> None:
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    with pytest.raises(ValidationError, match="rl"):
        plans_from_spec(REPO_TASK, train=rows, val=rows, output_root=tmp_path, method="grpo")
    with pytest.raises(ValidationError, match="rl"):
        plans_from_spec(
            REPO_TASK, train=rows, val=rows, output_root=tmp_path, rl={"reward": "exact_match"}
        )


def test_grpo_settings_choose_the_loss_and_keep_the_best_checkpoint_by_reward(
    tmp_path: Path,
) -> None:
    plan = _plan(tmp_path, loss="cispo", epsilon_high=5.0, importance_sampling_level="sequence")

    settings = grpo_settings(plan, "/work", "bfloat16")

    assert settings["loss_type"] == "cispo"
    assert settings["epsilon_high"] == 5.0
    assert settings["importance_sampling_level"] == "sequence"
    assert settings["metric_for_best_model"] == "eval_reward"
    assert settings["greater_is_better"] is True
    assert settings["beta"] == 0.0
    assert "completion_only_loss" not in settings


def test_rl_rows_keep_the_recorded_answer_as_the_reference() -> None:
    row = ChatRow.model_validate(
        {"messages": [{"role": "user", "content": "u"}, {"role": "assistant", "content": "a"}]}
    )

    assert to_rl_row(row) == {"prompt": [{"role": "user", "content": "u"}], "reference": "a"}


def test_the_reward_scores_each_completion_against_its_reference(tmp_path: Path) -> None:
    reward = reward_function(_plan(tmp_path).rl)  # pyright: ignore[reportArgumentType]
    completions = [
        [{"role": "assistant", "content": json.dumps({"a": 1})}],
        [{"role": "assistant", "content": "not json"}],
    ]

    scores = reward(completions, reference=[json.dumps({"a": 1}), json.dumps({"a": 1})])

    assert scores == [1.0, 0.0]


def test_a_task_reward_is_loaded_by_reference(tmp_path: Path) -> None:
    plan = _plan(tmp_path, reward="modelstill.evals:exact_match")
    reward = reward_function(plan.rl)  # pyright: ignore[reportArgumentType]

    assert reward(["same", "other"], reference=["same", "same"]) == [1.0, 0.0]


def test_no_environment_means_single_turn(tmp_path: Path) -> None:
    assert environment_factory(_plan(tmp_path).rl) is None  # pyright: ignore[reportArgumentType]
