import importlib
import importlib.metadata
import json
import sys
from pathlib import Path
from typing import Any

import fake_modal
import pytest

from modelstill.train import (
    Manifest,
    TrainedArtifact,
    TrainingPlan,
    load_backend,
    output_path,
    plans_from_spec,
)
from modelstill.train.modal_plan import (
    ARTIFACTS_MOUNT,
    DEFAULT_GPU,
    VOLUME_NAME,
    image_requirements,
    volume_plan,
)

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"
ROW = {
    "messages": [{"role": "user", "content": "a red car"}, {"role": "assistant", "content": "[]"}]
}


@pytest.fixture
def modal(monkeypatch: pytest.MonkeyPatch) -> Any:
    return fake_modal.install(monkeypatch)


@pytest.fixture
def plan(tmp_path: Path) -> TrainingPlan:
    data = tmp_path / "rows.jsonl"
    data.write_text(json.dumps(ROW) + "\n")
    val = tmp_path / "val.jsonl"
    val.write_text(json.dumps(ROW) + "\n\n")
    return plans_from_spec(REPO_TASK, train=data, val=val, output_root=tmp_path, seeds=[2])[0]


def _backend() -> Any:
    return importlib.import_module("modelstill.train.modal_backend")


def _remote_artifact(plan_json: str) -> dict[str, object]:
    remote_plan = TrainingPlan.model_validate_json(plan_json)
    manifest = Manifest(
        snapshot=remote_plan.snapshot,
        plan={"base": remote_plan.base},
        data={"train": "0" * 64, "val": "1" * 64},
        libraries={"torch": "2.15.0"},
        python="3.12.12",
    )
    return TrainedArtifact(
        path=output_path(remote_plan, manifest),
        base=remote_plan.base,
        dtype="bfloat16",
        metrics={"train_loss": 0.5},
        manifest=manifest,
    ).model_dump(mode="json")


def test_the_app_declares_a_pinned_image_gpu_timeout_and_the_artifact_volume(modal: Any) -> None:
    backend = _backend()
    function = backend.app.functions["train_remote"]

    assert function.options["gpu"] == DEFAULT_GPU
    assert 0 < function.options["timeout"] <= 24 * 3600
    assert function.options["volumes"][ARTIFACTS_MOUNT].name == VOLUME_NAME
    image = function.options["image"]
    assert image.packages() == image_requirements()
    assert ("add_local_python_source", ("modelstill",), {}) in image.steps
    assert image.steps[0][2] == {"python_version": "3.12"}


def test_load_backend_by_name_passes_gpu_and_timeout(modal: Any) -> None:
    trainer: Any = load_backend("modal", gpu="A10G", timeout_minutes=45)

    assert (trainer.gpu, trainer.timeout_minutes) == ("A10G", 45)


def test_train_uploads_data_and_plan_then_runs_one_remote_call(
    modal: Any, plan: TrainingPlan
) -> None:
    backend = _backend()
    function = backend.app.functions["train_remote"]
    sent: list[str] = []

    def run(plan_file: str) -> dict[str, object]:
        volume = fake_modal.VOLUMES[VOLUME_NAME]
        text = volume.files[plan_file].decode()
        sent.append(text)
        return _remote_artifact(text)

    function.result = run

    artifact = backend.ModalTrainer(gpu="L40S", timeout_minutes=60).train(plan)

    layout = volume_plan(plan)
    files = fake_modal.VOLUMES[VOLUME_NAME].files
    assert files[layout.train_remote] == plan.train_path.read_bytes()
    assert files[layout.val_remote] == plan.val_path.read_bytes()
    assert json.loads(sent[0])["output_root"] == f"{ARTIFACTS_MOUNT}/adapters"
    [(options, args)] = function.calls
    assert options["gpu"] == "L40S"
    assert options["timeout"] == 3600
    assert args == (layout.plan_remote,)
    assert artifact.path.parent == Path(ARTIFACTS_MOUNT) / "adapters" / "technographics"
    assert artifact.dtype == "bfloat16"
    assert backend.app.runs == 1


def test_inputs_already_in_the_volume_are_not_uploaded_again(
    modal: Any, plan: TrainingPlan
) -> None:
    backend = _backend()
    backend.app.functions["train_remote"].result = lambda plan_file: _remote_artifact(
        fake_modal.VOLUMES[VOLUME_NAME].files[plan_file].decode()
    )
    trainer = backend.ModalTrainer()

    trainer.train(plan)
    trainer.train(plan)

    assert len(backend.app.functions["train_remote"].calls) == 2


def test_the_remote_function_trains_with_the_trl_backend_and_commits(
    modal: Any, plan: TrainingPlan, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    backend = _backend()
    mount = tmp_path / "mount"
    layout = volume_plan(plan)
    (mount / layout.plan_remote).parent.mkdir(parents=True)
    (mount / layout.plan_remote).write_text(layout.plan_json())
    trained: list[TrainingPlan] = []

    class FakeTrl:
        def train(self, remote_plan: TrainingPlan) -> TrainedArtifact:
            trained.append(remote_plan)
            return TrainedArtifact.model_validate(_remote_artifact(remote_plan.model_dump_json()))

    fake_trl = type(sys)("modelstill.train.trl_backend")
    fake_trl.backend = FakeTrl
    monkeypatch.setitem(sys.modules, "modelstill.train.trl_backend", fake_trl)
    monkeypatch.setattr(backend, "ARTIFACTS_MOUNT", str(mount))

    result = backend.app.functions["train_remote"](layout.plan_remote)

    assert trained[0].train_path == layout.plan.train_path
    assert result["dtype"] == "bfloat16"
    assert fake_modal.VOLUMES[VOLUME_NAME].commits == 1


def test_only_trainable_methods_are_sent(modal: Any, plan: TrainingPlan) -> None:
    backend = _backend()
    with pytest.raises(ValueError, match="lora or full"):
        backend.ModalTrainer().train(plan.model_copy(update={"method": "classifier"}))
    assert backend.app.runs == 0


def test_the_module_imports_inside_the_container_without_package_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_modal.install(monkeypatch, local=False)

    def missing(name: str) -> None:
        raise importlib.metadata.PackageNotFoundError(name)

    monkeypatch.setattr(importlib.metadata, "requires", missing)

    assert _backend().image is not None
