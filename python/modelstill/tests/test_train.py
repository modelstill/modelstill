import json
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
from pydantic import ValidationError

from modelstill.spec import snapshot_hash
from modelstill.train import (
    ChatRow,
    Generation,
    TrainedArtifact,
    Trainer,
    TrainingPlan,
    build_manifest,
    file_sha256,
    flip_rate,
    load_artifact,
    output_path,
    plans_from_spec,
    read_chat_jsonl,
    staged_output,
    to_prompt,
    to_prompt_completion,
)

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"


def _row(user: str, answer: str) -> dict[str, object]:
    return {
        "messages": [
            {"role": "system", "content": "Extract colours as JSON."},
            {"role": "user", "content": user},
            {"role": "assistant", "content": answer},
        ]
    }


@pytest.fixture
def data(tmp_path: Path) -> tuple[Path, Path]:
    train = tmp_path / "train.jsonl"
    val = tmp_path / "val.jsonl"
    train.write_text(json.dumps(_row("a red car", '["red"]')) + "\n")
    val.write_text(json.dumps(_row("a blue sky", '["blue"]')) + "\n")
    return train, val


def _plan(data: tuple[Path, Path], tmp_path: Path) -> TrainingPlan:
    return plans_from_spec(REPO_TASK, train=data[0], val=data[1], output_root=tmp_path / "out")[0]


def test_plans_take_base_method_rank_and_one_plan_per_seed_from_the_spec(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    plans = plans_from_spec(REPO_TASK, train=data[0], val=data[1], output_root=tmp_path)

    assert [plan.seed for plan in plans] == [1, 2, 3]
    assert {plan.base for plan in plans} == {"Qwen/Qwen3-1.7B"}
    assert {plan.method for plan in plans} == {"lora"}
    assert {plan.lora_r for plan in plans} == {16}
    assert {plan.lora_alpha for plan in plans} == {32}
    assert {plan.task for plan in plans} == {"technographics"}
    assert {plan.snapshot for plan in plans} == {snapshot_hash(REPO_TASK)}


def test_overrides_replace_base_steps_and_pick_a_single_seed(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    plans = plans_from_spec(
        REPO_TASK,
        train=data[0],
        val=data[1],
        output_root=tmp_path,
        base="Qwen/Qwen3-0.6B",
        max_steps=5,
        seeds=[7],
    )

    assert len(plans) == 1
    assert (plans[0].base, plans[0].max_steps, plans[0].seed) == ("Qwen/Qwen3-0.6B", 5, 7)


def test_plan_is_frozen_and_rejects_unknown_fields(data: tuple[Path, Path], tmp_path: Path) -> None:
    plan = _plan(data, tmp_path)
    with pytest.raises(ValueError, match="frozen"):
        plan.seed = 9
    with pytest.raises(ValueError, match="mystery"):
        TrainingPlan.model_validate({**plan.model_dump(), "mystery": 1})


def test_manifest_hashes_training_files_plan_and_libraries(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    plan = _plan(data, tmp_path)
    manifest = build_manifest(plan, {"trl": "1.0"})

    assert manifest.data == {"train": file_sha256(data[0]), "val": file_sha256(data[1])}
    assert manifest.libraries == {"trl": "1.0"}
    assert manifest.python == sys.version.split()[0]
    assert len(manifest.digest()) == 64


def test_manifest_digest_changes_with_data_plan_or_libraries(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    plan = _plan(data, tmp_path)
    first = build_manifest(plan, {"trl": "1.0"}).digest()

    assert build_manifest(plan, {"trl": "1.0"}).digest() == first
    assert build_manifest(plan, {"trl": "1.1"}).digest() != first
    assert build_manifest(plan.model_copy(update={"seed": 2}), {"trl": "1.0"}).digest() != first
    data[0].write_text(json.dumps(_row("a green leaf", '["green"]')) + "\n")
    assert build_manifest(plan, {"trl": "1.0"}).digest() != first


def test_manifest_ignores_where_outputs_and_data_live(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    plan = _plan(data, tmp_path)
    moved = tmp_path / "elsewhere.jsonl"
    moved.write_bytes(data[0].read_bytes())
    relocated = plan.model_copy(update={"output_root": tmp_path / "other", "train_path": moved})

    assert build_manifest(relocated, {}).digest() == build_manifest(plan, {}).digest()


def test_output_path_is_versioned_by_snapshot_manifest_and_seed(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    plan = _plan(data, tmp_path)
    manifest = build_manifest(plan, {})

    path = output_path(plan, manifest)

    assert path == (
        tmp_path / "out" / "technographics" / f"{plan.snapshot[:8]}-{manifest.digest()[:8]}-s1"
    )


def test_staged_output_publishes_only_on_success_and_never_overwrites(tmp_path: Path) -> None:
    final = tmp_path / "task" / "abc-def-s1"
    with staged_output(final) as staging:
        (staging / "weights").write_text("w")
        assert not final.exists()
    assert (final / "weights").read_text() == "w"

    with pytest.raises(FileExistsError), staged_output(final):
        pass
    assert (final / "weights").read_text() == "w"


def test_staged_output_leaves_nothing_behind_on_failure(tmp_path: Path) -> None:
    final = tmp_path / "task" / "abc-def-s1"
    with pytest.raises(RuntimeError), staged_output(final) as staging:
        (staging / "half").write_text("x")
        raise RuntimeError("training crashed")

    assert not final.exists()
    assert list(final.parent.iterdir()) == []


def test_read_chat_jsonl_validates_roles_and_final_assistant_turn(tmp_path: Path) -> None:
    good = tmp_path / "good.jsonl"
    good.write_text(json.dumps(_row("a red car", '["red"]')) + "\n\n")
    assert [row.messages[-1].content for row in read_chat_jsonl(good)] == ['["red"]']

    bad = tmp_path / "bad.jsonl"
    no_answer = {"messages": [{"role": "user", "content": "hi"}]}
    bad.write_text(json.dumps(no_answer) + "\n")
    with pytest.raises(ValueError, match="line 1"):
        read_chat_jsonl(bad)


def test_prompt_completion_splits_off_the_final_assistant_turn(tmp_path: Path) -> None:
    path = tmp_path / "rows.jsonl"
    path.write_text(json.dumps(_row("a red car", '["red"]')) + "\n")

    record = to_prompt_completion(read_chat_jsonl(path)[0])

    assert [message["role"] for message in record["prompt"]] == ["system", "user"]
    assert record["completion"] == [{"role": "assistant", "content": '["red"]'}]


@dataclass
class FakeTrainer:
    def train(self, plan: TrainingPlan) -> TrainedArtifact:
        manifest = build_manifest(plan, {"fake": "0"})
        final = output_path(plan, manifest)
        with staged_output(final) as staging:
            (staging / "adapter.bin").write_text("weights")
            artifact = TrainedArtifact(
                path=final,
                base=plan.base,
                dtype="float32",
                metrics={"train_loss": 1.5, "eval_loss": 1.7},
                manifest=manifest,
            )
            artifact.write(staging)
        return artifact


def test_a_trainer_backend_produces_an_artifact_that_can_be_read_back(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    trainer: Trainer = FakeTrainer()
    plan = _plan(data, tmp_path)

    artifact = trainer.train(plan)

    assert load_artifact(artifact.path) == artifact
    with pytest.raises(FileExistsError):
        trainer.train(plan)


@dataclass
class Scripted:
    answers: dict[str, str]

    def generate(self, messages: list[dict[str, str]]) -> Generation:
        return Generation(text=self.answers[messages[-1]["content"]], mean_logprob=-0.1, tokens=1)


def test_flip_rate_is_the_share_of_prompts_whose_outputs_differ() -> None:
    prompts = [[{"role": "user", "content": key}] for key in "abcd"]
    first = Scripted({"a": "1", "b": "2", "c": "3", "d": "4"})
    second = Scripted({"a": "1", "b": "2", "c": "x", "d": "4 "})

    assert flip_rate(first, second, prompts) == 0.25
    with pytest.raises(ValueError, match="no prompts"):
        flip_rate(first, second, [])


def test_full_weight_plans_default_to_a_full_weight_learning_rate(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    [full] = plans_from_spec(
        REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1], method="full"
    )
    [chosen] = plans_from_spec(
        REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1], method="full",
        learning_rate=3e-5,
    )  # fmt: skip

    assert full.method == "full"
    assert full.learning_rate == 1e-5
    assert chosen.learning_rate == 3e-5


def test_a_distillation_plan_names_its_teacher(data: tuple[Path, Path], tmp_path: Path) -> None:
    [plan] = plans_from_spec(
        REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1],
        method="distill", distill={"teacher": "Qwen/Qwen3-4B"},
    )  # fmt: skip

    assert plan.distill is not None
    assert plan.distill.teacher == "Qwen/Qwen3-4B"
    assert plan.distill.beta == 1.0


def test_distillation_needs_a_teacher_and_only_distillation_has_one(
    data: tuple[Path, Path], tmp_path: Path
) -> None:
    with pytest.raises(ValidationError, match="teacher"):
        plans_from_spec(
            REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1], method="distill"
        )
    with pytest.raises(ValidationError, match="teacher"):
        plans_from_spec(
            REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1],
            distill={"teacher": "Qwen/Qwen3-4B"},
        )  # fmt: skip


def test_prompts_for_on_policy_training_drop_the_recorded_answer() -> None:
    row = ChatRow.model_validate(
        {
            "messages": [
                {"role": "system", "content": "s"},
                {"role": "user", "content": "u"},
                {"role": "assistant", "content": "a"},
            ]
        }
    )

    assert to_prompt(row) == {
        "prompt": [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    }


def test_four_bit_loading_is_for_lora_only(data: tuple[Path, Path], tmp_path: Path) -> None:
    [plan] = plans_from_spec(
        REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1], quantization="4bit"
    )
    assert plan.quantization == "4bit"

    with pytest.raises(ValidationError, match="4bit"):
        plans_from_spec(
            REPO_TASK, train=data[0], val=data[1], output_root=tmp_path, seeds=[1],
            quantization="4bit", method="full",
        )  # fmt: skip
