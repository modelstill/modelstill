# pyright: reportMissingImports=false

import tempfile
from pathlib import Path
from typing import Any

import modal

from modelstill.train import TRAINABLE, TrainedArtifact, TrainingPlan
from modelstill.train.modal_plan import (
    APP_NAME,
    ARTIFACTS_MOUNT,
    CPU_CORES,
    DEFAULT_GPU,
    HF_CACHE_MOUNT,
    HF_CACHE_VOLUME_NAME,
    MEMORY_GIB,
    PYTHON_VERSION,
    VOLUME_NAME,
    estimate,
    image_requirements,
    volume_plan,
)

DEFAULT_TIMEOUT_MINUTES = 4 * 60


image = (
    modal.Image.debian_slim(python_version=PYTHON_VERSION)
    .uv_pip_install(*(image_requirements() if modal.is_local() else []))
    .env({"HF_HOME": HF_CACHE_MOUNT, "TOKENIZERS_PARALLELISM": "false"})
    .add_local_python_source("modelstill")
)
artifacts = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
hf_cache = modal.Volume.from_name(HF_CACHE_VOLUME_NAME, create_if_missing=True)
app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=DEFAULT_GPU,
    timeout=DEFAULT_TIMEOUT_MINUTES * 60,
    cpu=CPU_CORES,
    memory=MEMORY_GIB * 1024,
    volumes={ARTIFACTS_MOUNT: artifacts, HF_CACHE_MOUNT: hf_cache},
    retries=0,
)
def train_remote(plan_file: str) -> dict[str, Any]:
    from modelstill.train import trl_backend  # noqa: PLC0415

    artifacts.reload()
    plan = TrainingPlan.model_validate_json((Path(ARTIFACTS_MOUNT) / plan_file).read_text())
    artifact = trl_backend.backend().train(plan)
    artifacts.commit()
    return artifact.model_dump(mode="json")


def _upload(remote: str, local: Path) -> None:
    try:
        with artifacts.batch_upload(force=False) as batch:
            batch.put_file(local, remote)
    except FileExistsError:
        return


class ModalTrainer:
    def __init__(self, gpu: str = DEFAULT_GPU, timeout_minutes: int | None = None) -> None:
        self.gpu = gpu
        self.timeout_minutes = timeout_minutes

    def train(self, plan: TrainingPlan) -> TrainedArtifact:
        if plan.method not in TRAINABLE:
            raise ValueError(f"the Modal backend trains lora or full plans, not {plan.method!r}")
        cap = estimate(plan, self.gpu, self.timeout_minutes).timeout_minutes
        layout = volume_plan(plan)
        _upload(layout.train_remote, plan.train_path)
        _upload(layout.val_remote, plan.val_path)
        with tempfile.TemporaryDirectory() as scratch:
            plan_file = Path(scratch) / "plan.json"
            plan_file.write_text(layout.plan_json())
            _upload(layout.plan_remote, plan_file)
        registered: Any = train_remote
        function = registered.with_options(gpu=self.gpu, timeout=cap * 60)
        with modal.enable_output(), app.run():
            result = function.remote(layout.plan_remote)
        return TrainedArtifact.model_validate(result)


def backend(gpu: str = DEFAULT_GPU, timeout_minutes: int | None = None) -> ModalTrainer:
    return ModalTrainer(gpu=gpu, timeout_minutes=timeout_minutes)
