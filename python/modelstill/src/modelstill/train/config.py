from pathlib import Path
from typing import Any

from modelstill.train import TrainingPlan


def sft_settings(plan: TrainingPlan, work_dir: str, dtype: str) -> dict[str, Any]:
    return {
        "output_dir": work_dir,
        "seed": plan.seed,
        "learning_rate": plan.learning_rate,
        "num_train_epochs": plan.epochs,
        "max_steps": plan.max_steps or -1,
        "per_device_train_batch_size": plan.batch_size,
        "per_device_eval_batch_size": plan.batch_size,
        "gradient_accumulation_steps": plan.gradient_accumulation,
        "max_length": plan.max_seq_length,
        "completion_only_loss": True,
        "packing": False,
        "eval_strategy": "steps",
        "eval_steps": plan.eval_steps,
        "logging_steps": 1,
        "save_strategy": "steps",
        "save_steps": plan.eval_steps,
        "save_total_limit": 2,
        "load_best_model_at_end": True,
        "metric_for_best_model": "eval_loss",
        "greater_is_better": False,
        "report_to": "none",
        "bf16": dtype == "bfloat16",
        "fp16": dtype == "float16",
        "dataloader_pin_memory": False,
        "disable_tqdm": True,
        "gradient_checkpointing": plan.gradient_checkpointing,
        "ddp_find_unused_parameters": False,
        **(
            {"gradient_checkpointing_kwargs": {"use_reentrant": False}}
            if plan.gradient_checkpointing
            else {}
        ),
    }


def resume_from(work_dir: Path) -> str | None:
    if not work_dir.is_dir():
        return None
    steps = [
        (int(entry.name.removeprefix("checkpoint-")), entry)
        for entry in work_dir.iterdir()
        if entry.is_dir() and entry.name.removeprefix("checkpoint-").isdigit()
    ]
    return str(max(steps)[1]) if steps else None


_SFT_ONLY = ("max_length", "completion_only_loss", "packing")


def distill_settings(plan: TrainingPlan, work_dir: str, dtype: str) -> dict[str, Any]:
    if plan.distill is None:
        raise ValueError("a distillation plan needs distill settings")
    settings = {k: v for k, v in sft_settings(plan, work_dir, dtype).items() if k not in _SFT_ONLY}
    return {
        **settings,
        "teacher_model_init_kwargs": {"dtype": dtype},
        "beta": plan.distill.beta,
        "temperature": plan.distill.temperature,
        "max_completion_length": plan.distill.max_completion_length,
        "chat_template_kwargs": {"enable_thinking": False},
    }


def grpo_settings(plan: TrainingPlan, work_dir: str, dtype: str) -> dict[str, Any]:
    if plan.rl is None:
        raise ValueError("a grpo plan needs rl settings")
    rl = plan.rl
    settings = {k: v for k, v in sft_settings(plan, work_dir, dtype).items() if k not in _SFT_ONLY}
    return {
        **settings,
        "loss_type": rl.loss,
        "importance_sampling_level": rl.importance_sampling_level,
        "epsilon": rl.epsilon,
        **({"epsilon_high": rl.epsilon_high} if rl.epsilon_high is not None else {}),
        "num_generations": rl.num_generations,
        "max_completion_length": rl.max_completion_length,
        "beta": rl.kl_beta,
        "temperature": rl.temperature,
        "chat_template_kwargs": {"enable_thinking": False},
        "metric_for_best_model": "eval_reward",
        "greater_is_better": True,
    }
