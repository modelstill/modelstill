import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from modelstill import cli
from modelstill.train import (
    Generation,
    TrainedArtifact,
    TrainingPlan,
    build_manifest,
    load_backend,
    output_path,
    staged_output,
)

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"
ROW = {
    "messages": [
        {"role": "user", "content": "a red car"},
        {"role": "assistant", "content": '["red"]'},
    ]
}


@dataclass
class RecordingTrainer:
    plans: list[TrainingPlan] = field(default_factory=list)

    def train(self, plan: TrainingPlan) -> TrainedArtifact:
        self.plans.append(plan)
        manifest = build_manifest(plan, {})
        final = output_path(plan, manifest)
        with staged_output(final) as staging:
            artifact = TrainedArtifact(
                path=final,
                base=plan.base,
                dtype="float32",
                metrics={"loss": 1.0},
                manifest=manifest,
            )
            artifact.write(staging)
        return artifact


def test_train_run_builds_plans_with_overrides_and_prints_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    trainer = RecordingTrainer()
    monkeypatch.setattr(cli, "load_backend", lambda name: trainer)

    code = cli.main(
        [
            "train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data),
            "--base", "Qwen/Qwen3-0.6B", "--max-steps", "3", "--seed", "5",
            "--max-seq-length", "256", "--output-root", str(tmp_path / "out"),
        ]
    )  # fmt: skip

    assert code == 0
    [plan] = trainer.plans
    assert (plan.base, plan.max_steps, plan.seed, plan.max_seq_length) == (
        "Qwen/Qwen3-0.6B", 3, 5, 256
    )  # fmt: skip
    printed = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert printed["path"].startswith(str(tmp_path / "out" / "technographics"))
    assert printed["metrics"] == {"loss": 1.0}


def test_train_run_trains_every_spec_seed_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    trainer = RecordingTrainer()
    monkeypatch.setattr(cli, "load_backend", lambda name: trainer)

    argv = ["train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data)]
    assert cli.main([*argv, "--output-root", str(tmp_path)]) == 0
    assert [plan.seed for plan in trainer.plans] == [1, 2, 3]


def test_train_run_reports_an_existing_artifact_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    monkeypatch.setattr(cli, "load_backend", lambda name: RecordingTrainer())
    argv = ["train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data)]
    argv += ["--seed", "1", "--output-root", str(tmp_path)]

    assert cli.main(argv) == 0
    assert cli.main(argv) == 1
    assert "never overwritten" in capsys.readouterr().err


@dataclass
class EchoModel:
    def generate(self, messages: list[dict[str, str]]) -> Generation:
        return Generation(text=messages[-1]["content"].upper(), mean_logprob=-0.25, tokens=3)


def test_train_infer_accepts_inline_json_or_a_file_and_prints_text_and_logprob(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    loaded: list[tuple[Path, int]] = []

    def load(path: Path, max_new_tokens: int) -> EchoModel:
        loaded.append((path, max_new_tokens))
        return EchoModel()

    monkeypatch.setattr(cli, "load_local_model", load)
    request = tmp_path / "request.json"
    request.write_text(json.dumps({"messages": [{"role": "user", "content": "hi"}]}))

    assert cli.main(["train", "infer", str(tmp_path), str(request)]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "text": "HI",
        "mean_logprob": -0.25,
        "tokens": 3,
    }
    inline = json.dumps([{"role": "user", "content": "yo"}])
    assert cli.main(["train", "infer", str(tmp_path), inline, "--max-new-tokens", "9"]) == 0
    assert json.loads(capsys.readouterr().out)["text"] == "YO"
    assert loaded == [(tmp_path, 256), (tmp_path, 9)]


def test_unknown_backend_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown training backend"):
        load_backend("nope")


def test_the_core_and_cli_never_import_training_libraries() -> None:
    probe = (
        "import sys, modelstill.cli, modelstill.train; "
        "heavy = {'torch', 'transformers', 'trl', 'peft', 'accelerate', 'datasets', 'modal'}; "
        "print(sorted(heavy & set(sys.modules)))"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "[]"


def test_modal_dry_run_prints_plan_gpu_timeout_and_cost_without_loading_a_backend(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")

    def refuse(name: str, **options: object) -> None:
        raise AssertionError("a dry run must not load the backend")

    monkeypatch.setattr(cli, "load_backend", refuse)
    monkeypatch.delitem(sys.modules, "modal", raising=False)
    argv = ["train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data)]
    argv += ["--backend", "modal", "--dry-run", "--gpu", "H100", "--timeout-minutes", "30"]
    argv += ["--batch-size", "2", "--gradient-accumulation", "2", "--eval-steps", "200"]

    assert cli.main(argv) == 0
    reports = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert [report["plan"]["seed"] for report in reports] == [1, 2, 3]
    assert {report["gpu"] for report in reports} == {"H100"}
    assert {report["timeout_minutes"] for report in reports} == {30}
    plan = reports[0]["plan"]
    assert (plan["batch_size"], plan["gradient_accumulation"], plan["eval_steps"]) == (2, 2, 200)
    assert "modal" not in sys.modules


def test_dry_run_and_gpu_options_are_only_for_the_modal_backend(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    argv = ["train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data)]

    assert cli.main([*argv, "--dry-run"]) == 1
    assert cli.main([*argv, "--gpu", "L40S"]) == 1
    assert capsys.readouterr().err.count("--backend modal") == 2


def test_gpu_and_timeout_are_passed_to_the_modal_backend(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    seen: list[tuple[str, dict[str, object]]] = []

    def load(name: str, **options: object) -> RecordingTrainer:
        seen.append((name, options))
        return RecordingTrainer()

    monkeypatch.setattr(cli, "load_backend", load)
    argv = ["train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data)]
    argv += ["--seed", "1", "--output-root", str(tmp_path), "--backend", "modal"]

    assert cli.main([*argv, "--gpu", "L40S", "--timeout-minutes", "90"]) == 0
    assert seen == [("modal", {"gpu": "L40S", "timeout_minutes": 90})]


def test_train_run_on_a_remote_host_passes_the_host_options(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    trainer = RecordingTrainer()
    loaded: dict[str, object] = {}

    def load(name: str, **options: object) -> RecordingTrainer:
        loaded.update(options, backend=name)
        return trainer

    monkeypatch.setattr(cli, "load_backend", load)

    code = cli.main(
        [
            "train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data),
            "--seed", "1", "--output-root", str(tmp_path / "out"), "--backend", "remote",
            "--host", "gpu-box", "--gpus", "0,1,2", "--stop-service", "llama-server",
            "--gradient-checkpointing",
        ]
    )  # fmt: skip

    assert code == 0
    assert loaded == {
        "backend": "remote",
        "host": "gpu-box",
        "gpus": "0,1,2",
        "stop_services": ["llama-server"],
    }
    assert trainer.plans[0].gradient_checkpointing is True


def test_host_options_need_the_remote_backend(tmp_path: Path) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")

    code = cli.main(
        ["train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data), "--host", "x"]
    )

    assert code != 0


def test_train_run_builds_a_distillation_plan_from_the_flags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    trainer = RecordingTrainer()
    monkeypatch.setattr(cli, "load_backend", lambda name, **options: trainer)

    code = cli.main(
        [
            "train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data),
            "--seed", "1", "--output-root", str(tmp_path / "out"),
            "--method", "distill", "--teacher", "Qwen/Qwen3-4B", "--beta", "0.5",
            "--max-completion-length", "600",
        ]
    )  # fmt: skip

    assert code == 0
    distill = trainer.plans[0].distill
    assert distill is not None
    assert (distill.teacher, distill.beta) == ("Qwen/Qwen3-4B", 0.5)
    assert distill.max_completion_length == 600


def test_train_run_builds_a_grpo_plan_from_the_flags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    trainer = RecordingTrainer()
    monkeypatch.setattr(cli, "load_backend", lambda name, **options: trainer)

    code = cli.main(
        [
            "train", "run", str(REPO_TASK), "--train", str(data), "--val", str(data),
            "--seed", "1", "--output-root", str(tmp_path / "out"), "--method", "grpo",
            "--reward", "json_equal", "--loss", "cispo", "--num-generations", "8",
            "--max-completion-length", "256",
        ]
    )  # fmt: skip

    assert code == 0
    rl = trainer.plans[0].rl
    assert rl is not None
    assert (rl.reward, rl.loss, rl.num_generations) == ("json_equal", "cispo", 8)
    assert rl.max_completion_length == 256
