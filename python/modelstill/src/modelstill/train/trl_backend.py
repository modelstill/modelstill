# pyright: reportMissingImports=false

import io
import json
import os
import shutil
import tempfile
from typing import Any

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import (
    AutoModelForCausalLM,
    AutoModelForImageTextToText,
    AutoProcessor,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainerCallback,
    set_seed,
)
from trl.trainer.distillation_config import DistillationConfig
from trl.trainer.distillation_trainer import DistillationTrainer
from trl.trainer.grpo_config import GRPOConfig
from trl.trainer.grpo_trainer import GRPOTrainer
from trl.trainer.sft_config import SFTConfig
from trl.trainer.sft_trainer import SFTTrainer

from modelstill.attest import ATTESTATION_FILE, GIT_COMMIT_ENV, build_attestation
from modelstill.train import (
    TRAINABLE,
    TrainedArtifact,
    TrainingPlan,
    build_manifest,
    library_versions,
    output_path,
    read_chat_jsonl,
    staged_output,
    to_prompt,
    to_prompt_completion,
)
from modelstill.train.config import distill_settings, grpo_settings, resume_from, sft_settings
from modelstill.train.console import ConsoleReporter, console_from_env
from modelstill.train.rl import environment_factory, reward_function, to_rl_row
from modelstill.train.vision import vision_record

_DTYPES = {"float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}


def device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def resolve_dtype(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available() and torch.cuda.is_bf16_supported():
        return "bfloat16"
    return "float32"


def _dataset(path: Any) -> Dataset:
    return Dataset.from_list([to_prompt_completion(row) for row in read_chat_jsonl(path)])


def _vision_dataset(path: Any) -> Dataset:
    from PIL import Image  # noqa: PLC0415

    records = []
    for row in read_chat_jsonl(path):
        record = vision_record(row)
        record["images"] = [Image.open(io.BytesIO(data)) for data in record["images"]]
        records.append(record)
    return Dataset.from_list(records)


class _Console(TrainerCallback):
    def __init__(self, reporter: ConsoleReporter) -> None:
        self.reporter = reporter

    def on_log(self, args: Any, state: Any, control: Any, logs: Any = None, **_: Any) -> None:
        if not state.is_world_process_zero or not logs:
            return
        numbers = {
            name: float(value)
            for name, value in logs.items()
            if isinstance(value, int | float) and not isinstance(value, bool)
        }
        self.reporter.on_log(int(state.global_step), state.epoch, numbers)


def _reporter(plan: TrainingPlan, final: Any) -> ConsoleReporter | None:
    if os.environ.get("RANK", "0") != "0":
        return None
    task = os.environ.get("MODELSTILL_CONSOLE_TASK") or plan.task
    return console_from_env(task, f"{final.parent.name}-{final.name}", plan.base, plan.method)


def _load_kwargs(plan: TrainingPlan, dtype: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"dtype": _DTYPES[dtype]}
    if plan.quantization == "4bit":
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=_DTYPES[dtype],
        )
        kwargs["device_map"] = {"": int(os.environ.get("LOCAL_RANK", "0"))}
    return kwargs


def _prompts(path: Any) -> Dataset:
    return Dataset.from_list([to_prompt(row) for row in read_chat_jsonl(path)])


def _rl_rows(path: Any) -> Dataset:
    return Dataset.from_list([to_rl_row(row) for row in read_chat_jsonl(path)])


def _grpo(plan: TrainingPlan, model: Any, tokenizer: Any, work_dir: str, dtype: str) -> Any:
    assert plan.rl is not None
    extra: dict[str, Any] = {}
    environments = environment_factory(plan.rl)
    if environments is not None:
        extra["environment_factory"] = environments
    return GRPOTrainer(
        model=model,
        reward_funcs=reward_function(plan.rl),
        args=GRPOConfig(**grpo_settings(plan, work_dir, dtype)),
        train_dataset=_rl_rows(plan.train_path),
        eval_dataset=_rl_rows(plan.val_path),
        processing_class=tokenizer,
        peft_config=_lora(plan),
        **extra,
    )


def _trainer(plan: TrainingPlan, model: Any, tokenizer: Any, work_dir: str, dtype: str) -> Any:
    if plan.rl is not None:
        return _grpo(plan, model, tokenizer, work_dir, dtype)
    if plan.distill is None:
        load = _vision_dataset if plan.modality == "vision" else _dataset
        return SFTTrainer(
            model=model,
            args=_config(plan, work_dir, dtype),
            train_dataset=load(plan.train_path),
            eval_dataset=load(plan.val_path),
            processing_class=tokenizer,
            peft_config=_lora(plan),
        )
    teacher = AutoTokenizer.from_pretrained(plan.distill.teacher)
    if teacher.get_vocab() != tokenizer.get_vocab():
        raise ValueError(f"{plan.distill.teacher} and {plan.base} tokenize differently")
    return DistillationTrainer(
        model=model,
        teacher_model=plan.distill.teacher,
        args=DistillationConfig(**distill_settings(plan, work_dir, dtype)),
        train_dataset=_prompts(plan.train_path),
        eval_dataset=_prompts(plan.val_path),
        processing_class=tokenizer,
        peft_config=_lora(plan),
    )


def _lora(plan: TrainingPlan) -> LoraConfig | None:
    if plan.method == "full":
        return None
    return LoraConfig(
        r=plan.lora_r,
        lora_alpha=plan.lora_alpha,
        lora_dropout=plan.lora_dropout,
        target_modules=(
            plan.target_modules
            if isinstance(plan.target_modules, str)
            else list(plan.target_modules)
        ),
        task_type="CAUSAL_LM",
    )


def _config(plan: TrainingPlan, work_dir: str, dtype: str) -> SFTConfig:
    return SFTConfig(**sft_settings(plan, work_dir, dtype))


def completion_mask(base: str, record: dict[str, Any], max_seq_length: int) -> list[int]:
    tokenizer = AutoTokenizer.from_pretrained(base)
    model = AutoModelForCausalLM.from_pretrained(base)
    with tempfile.TemporaryDirectory() as work_dir:
        config = SFTConfig(
            output_dir=work_dir,
            max_length=max_seq_length,
            completion_only_loss=True,
            report_to="none",
            use_cpu=True,
        )
        trainer = SFTTrainer(
            model=model,
            args=config,
            train_dataset=Dataset.from_list([record]),
            processing_class=tokenizer,
        )
        dataset: Any = trainer.train_dataset
        return [int(label != -100) for label in dataset[0]["labels"]]


class TrlTrainer:
    def train(self, plan: TrainingPlan) -> TrainedArtifact:
        if plan.method not in TRAINABLE:
            raise ValueError(f"the TRL backend trains lora or full plans, not {plan.method!r}")
        manifest = build_manifest(plan, library_versions())
        final = output_path(plan, manifest)
        if final.exists():
            raise FileExistsError(f"{final} already exists; artifact paths are never overwritten")
        dtype = resolve_dtype(plan.dtype)
        work_dir = final.parent / f".{final.name}.work"
        set_seed(plan.seed)
        if plan.modality == "vision":
            tokenizer = AutoProcessor.from_pretrained(plan.base)
            model = AutoModelForImageTextToText.from_pretrained(
                plan.base, **_load_kwargs(plan, dtype)
            )
        else:
            tokenizer = AutoTokenizer.from_pretrained(plan.base)
            model = AutoModelForCausalLM.from_pretrained(plan.base, **_load_kwargs(plan, dtype))
        trainer = _trainer(plan, model, tokenizer, str(work_dir), dtype)
        reporter = _reporter(plan, final)
        if reporter is not None:
            reporter.start(manifest=manifest.model_dump(mode="json"))
            trainer.add_callback(_Console(reporter))
        resume = resume_from(work_dir)
        try:
            result = trainer.train(resume_from_checkpoint=resume)
        except BaseException:
            if reporter is not None:
                reporter.finish("failed")
            raise
        evaluation = trainer.evaluate()
        history = trainer.state.log_history
        tokenized: Any = trainer.train_dataset
        train_lengths = (
            [len(ids) for ids in tokenized["input_ids"]]
            if "input_ids" in tokenized.column_names
            else []
        )
        metrics = {
            "train_loss": float(result.training_loss),
            **{
                key: float(evaluation[key])
                for key in ("eval_loss", "eval_reward")
                if key in evaluation
            },
            "steps": float(result.global_step),
            "train_runtime_s": float(result.metrics["train_runtime"]),
            "train_rows": float(len(tokenized)),
            "rows_at_max_length": float(
                sum(length >= plan.max_seq_length for length in train_lengths)
            ),
            "processes": float(trainer.args.world_size),
            "resumed": float(resume is not None),
        }
        logged = [entry["loss"] for entry in history if "loss" in entry]
        if logged:
            metrics["first_logged_loss"] = float(logged[0])
            metrics["last_logged_loss"] = float(logged[-1])
        artifact = TrainedArtifact(
            path=final,
            base=plan.base,
            dtype=dtype,
            metrics=metrics,
            manifest=manifest,
            kind="merged" if plan.method == "full" else "adapter",
        )
        if not trainer.is_world_process_zero():
            return artifact
        with staged_output(final) as staging:
            adapter: Any = trainer.model
            adapter.save_pretrained(staging)
            tokenizer.save_pretrained(staging)
            (staging / "log_history.json").write_text(json.dumps(history, indent=2) + "\n")
            artifact.write(staging)
            attestation = build_attestation(
                manifest,
                {"train": plan.train_path, "val": plan.val_path},
                git_commit=os.environ.get(GIT_COMMIT_ENV, ""),
            )
            (staging / ATTESTATION_FILE).write_text(json.dumps(attestation, indent=2) + "\n")
        shutil.rmtree(work_dir, ignore_errors=True)
        if reporter is not None:
            reporter.finish("succeeded", metrics=metrics, attestation=attestation)
        return artifact


def backend() -> TrlTrainer:
    return TrlTrainer()
