from pathlib import Path

from modelstill.train import plans_from_spec
from modelstill.train.config import distill_settings, resume_from, sft_settings

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"


def test_the_published_adapter_is_the_best_checkpoint_by_validation_loss(tmp_path: Path) -> None:
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    plan = plans_from_spec(
        REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1], eval_steps=200
    )[0]

    settings = sft_settings(plan, "/work", "bfloat16")

    assert settings["save_strategy"] == "steps"
    assert settings["save_steps"] == settings["eval_steps"] == 200
    assert settings["load_best_model_at_end"] is True
    assert settings["metric_for_best_model"] == "eval_loss"
    assert settings["greater_is_better"] is False
    assert settings["save_total_limit"] == 2
    assert settings["bf16"] is True and settings["fp16"] is False
    assert settings["completion_only_loss"] is True


def test_gradient_checkpointing_is_off_unless_the_plan_asks(tmp_path: Path) -> None:
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    [plan] = plans_from_spec(REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1])

    assert sft_settings(plan, "/work", "bfloat16")["gradient_checkpointing"] is False

    on = sft_settings(plan.model_copy(update={"gradient_checkpointing": True}), "/w", "bfloat16")
    assert on["gradient_checkpointing"] is True
    assert on["gradient_checkpointing_kwargs"] == {"use_reentrant": False}
    assert on["ddp_find_unused_parameters"] is False


def test_a_run_resumes_only_when_an_earlier_attempt_left_a_checkpoint(tmp_path: Path) -> None:
    work = tmp_path / ".final.work"
    assert resume_from(work) is None
    work.mkdir()
    (work / "runs").mkdir()
    assert resume_from(work) is None
    (work / "checkpoint-200").mkdir()
    (work / "checkpoint-1000").mkdir()
    assert resume_from(work) == str(work / "checkpoint-1000")


def test_distillation_settings_name_the_teacher_and_keep_the_best_checkpoint(
    tmp_path: Path,
) -> None:
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    [plan] = plans_from_spec(
        REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1], method="distill",
        distill={"teacher": "Qwen/Qwen3-4B", "beta": 0.5, "max_completion_length": 512},
    )  # fmt: skip

    settings = distill_settings(plan, "/work", "bfloat16")

    assert settings["teacher_model_init_kwargs"] == {"dtype": "bfloat16"}
    assert settings["beta"] == 0.5
    assert settings["max_completion_length"] == 512
    assert settings["chat_template_kwargs"] == {"enable_thinking": False}
    assert settings["load_best_model_at_end"] is True
    assert "completion_only_loss" not in settings
    assert "max_length" not in settings
