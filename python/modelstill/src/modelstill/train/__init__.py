import hashlib
import importlib
import json
import shutil
import sys
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from importlib import metadata
from pathlib import Path
from typing import Annotated, Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from modelstill.jsonl import jsonl_lines
from modelstill.spec import load_spec, snapshot_hash

ARTIFACT_FILE = "artifact.json"
TRAINING_LIBRARIES = ("torch", "transformers", "trl", "peft", "accelerate", "datasets")
BACKENDS = {
    "trl": "modelstill.train.trl_backend",
    "modal": "modelstill.train.modal_backend",
    "remote": "modelstill.train.remote_backend",
}
BACKEND_EXTRAS = {"trl": "train", "modal": "modal", "remote": "core"}

TRAINABLE = frozenset({"lora", "full", "distill", "grpo"})
FULL_WEIGHT_LEARNING_RATE = 1e-5

_LOCATION_FIELDS = frozenset({"train_path", "val_path", "output_root"})


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DistillSettings(_Strict):
    teacher: str
    beta: float = Field(default=1.0, ge=0, le=1)
    temperature: float = Field(default=1.0, gt=0)
    max_completion_length: int = Field(default=1024, gt=0)


class RlSettings(_Strict):
    reward: str = "exact_match"
    reward_args: dict[str, Any] = Field(default_factory=dict)
    loss: Literal["grpo", "dr_grpo", "dapo", "bnpo", "cispo"] = "dapo"
    importance_sampling_level: Literal["token", "sequence"] = "token"
    epsilon: float = Field(default=0.2, gt=0)
    epsilon_high: float | None = Field(default=None, gt=0)
    num_generations: int = Field(default=4, ge=2)
    max_completion_length: int = Field(default=1024, gt=0)
    kl_beta: float = Field(default=0.0, ge=0)
    temperature: float = Field(default=1.0, gt=0)
    environment: str | None = None


class TrainingPlan(_Strict):
    task: str
    snapshot: str
    base: str
    method: Literal["lora", "full", "distill", "grpo", "classifier"]
    lora_r: int = Field(default=16, gt=0)
    lora_alpha: int = Field(default=32, gt=0)
    lora_dropout: float = Field(default=0.05, ge=0, lt=1)
    target_modules: str | tuple[str, ...] = "all-linear"
    seed: int
    max_steps: int | None = Field(default=None, gt=0)
    epochs: float = Field(default=3.0, gt=0)
    learning_rate: float = Field(default=2e-4, gt=0)
    batch_size: int = Field(default=4, gt=0)
    gradient_accumulation: int = Field(default=1, gt=0)
    max_seq_length: int = Field(default=2048, gt=0)
    eval_steps: int = Field(default=50, gt=0)
    gradient_checkpointing: bool = False
    modality: Literal["text", "vision"] = "text"
    quantization: Literal["none", "4bit"] = "none"
    distill: DistillSettings | None = None
    rl: RlSettings | None = None
    dtype: Literal["auto", "float32", "bfloat16", "float16"] = "auto"
    train_path: Path
    val_path: Path
    output_root: Path

    @model_validator(mode="after")
    def _settings_match_the_method(self) -> "TrainingPlan":
        if (self.method == "distill") != (self.distill is not None):
            raise ValueError(
                "method distill needs distill.teacher, and only distillation has a teacher"
            )
        if (self.method == "grpo") != (self.rl is not None):
            raise ValueError("method grpo needs rl settings, and only grpo has them")
        if self.quantization == "4bit" and self.method == "full":
            raise ValueError("4bit loading trains LoRA adapters, not every weight")
        if self.modality == "vision" and self.method not in {"lora", "full"}:
            raise ValueError("vision plans train with lora or full SFT")
        return self


def plans_from_spec(
    spec_path: Path,
    *,
    train: Path,
    val: Path,
    output_root: Path,
    base: str | None = None,
    seeds: Sequence[int] | None = None,
    **settings: object,
) -> list[TrainingPlan]:
    spec = load_spec(spec_path)
    rank = spec.train.lora_r or 16
    fields: dict[str, object] = {
        "task": spec.task,
        "snapshot": snapshot_hash(spec_path),
        "base": base or spec.train.base,
        "method": spec.train.method,
        "lora_r": rank,
        "lora_alpha": 2 * rank,
        "train_path": train,
        "val_path": val,
        "output_root": output_root,
        **settings,
    }
    if fields["method"] == "full" and "learning_rate" not in settings:
        fields["learning_rate"] = FULL_WEIGHT_LEARNING_RATE
    return [
        TrainingPlan.model_validate({**fields, "seed": seed})
        for seed in (seeds if seeds is not None else spec.train.seeds)
    ]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def library_versions(names: Sequence[str] = TRAINING_LIBRARIES) -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = "missing"
    return versions


class Manifest(_Strict):
    snapshot: str
    plan: dict[str, object]
    data: dict[str, str]
    libraries: dict[str, str]
    python: str

    def digest(self) -> str:
        canonical = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()


def build_manifest(plan: TrainingPlan, libraries: Mapping[str, str]) -> Manifest:
    return Manifest(
        snapshot=plan.snapshot,
        plan=plan.model_dump(mode="json", exclude=set(_LOCATION_FIELDS)),
        data={"train": file_sha256(plan.train_path), "val": file_sha256(plan.val_path)},
        libraries=dict(libraries),
        python=sys.version.split()[0],
    )


def output_path(plan: TrainingPlan, manifest: Manifest) -> Path:
    name = f"{plan.snapshot[:8]}-{manifest.digest()[:8]}-s{plan.seed}"
    return plan.output_root / plan.task / name


@contextmanager
def staged_output(final: Path) -> Iterator[Path]:
    if final.exists():
        raise FileExistsError(f"{final} already exists; artifact paths are never overwritten")
    final.parent.mkdir(parents=True, exist_ok=True)
    staging = final.parent / f".{final.name}.partial-{uuid.uuid4().hex[:8]}"
    staging.mkdir()
    try:
        yield staging
        if final.exists():
            raise FileExistsError(f"{final} appeared while training; refusing to overwrite it")
        staging.rename(final)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


class TrainedArtifact(_Strict):
    path: Path
    base: str
    dtype: str
    metrics: dict[str, float]
    manifest: Manifest
    kind: Literal["adapter", "merged"] = "adapter"

    def write(self, directory: Path) -> None:
        (directory / ARTIFACT_FILE).write_text(self.model_dump_json(indent=2) + "\n")


def load_artifact(path: Path) -> TrainedArtifact:
    return TrainedArtifact.model_validate_json((path / ARTIFACT_FILE).read_text())


class Trainer(Protocol):
    def train(self, plan: TrainingPlan) -> TrainedArtifact: ...


def load_backend(name: str, **options: object) -> Trainer:
    if name not in BACKENDS:
        raise ValueError(f"unknown training backend {name!r}; known: {sorted(BACKENDS)}")
    extra = BACKEND_EXTRAS[name]
    try:
        module = importlib.import_module(BACKENDS[name])
    except ImportError as error:
        raise RuntimeError(
            f"training backend {name!r} needs the {extra} extra: pip install 'modelstill[{extra}]'"
        ) from error
    return module.backend(**options)


def served_name(path: Path) -> str:
    return f"{path.parent.name}-{path.name}"


def load_local_model(path: Path, max_new_tokens: int = 256) -> "Generator":
    try:
        module = importlib.import_module("modelstill.train.local_infer")
    except ImportError as error:
        raise RuntimeError(
            "local inference needs the train extra: pip install 'modelstill[train]'"
        ) from error
    return module.LocalModel.from_artifact(path, max_new_tokens=max_new_tokens)


class TextPart(_Strict):
    type: Literal["text"]
    text: str


class ImagePart(_Strict):
    type: Literal["image"]
    image: str


class Message(_Strict):
    role: Literal["system", "user", "assistant"]
    content: str | list[Annotated[TextPart | ImagePart, Field(discriminator="type")]]


class ChatRow(_Strict):
    messages: list[Message] = Field(min_length=2)


def read_chat_jsonl(path: Path) -> list[ChatRow]:
    rows: list[ChatRow] = []
    for number, line in enumerate(jsonl_lines(path.read_text()), start=1):
        if not line.strip():
            continue
        try:
            row = ChatRow.model_validate_json(line)
        except ValueError as error:
            raise ValueError(f"{path} line {number}: {error}") from error
        if row.messages[-1].role != "assistant":
            raise ValueError(f"{path} line {number}: the last message must be the assistant's")
        rows.append(row)
    return rows


def to_prompt(row: ChatRow) -> dict[str, list[dict[str, str]]]:
    return {"prompt": [message.model_dump() for message in row.messages[:-1]]}


def to_prompt_completion(row: ChatRow) -> dict[str, list[dict[str, str]]]:
    messages = [message.model_dump() for message in row.messages]
    return {"prompt": messages[:-1], "completion": messages[-1:]}


class Generation(_Strict):
    text: str
    mean_logprob: float
    tokens: int


class Generator(Protocol):
    def generate(self, messages: list[dict[str, str]]) -> Generation: ...


def flip_rate(
    model_a: Generator, model_b: Generator, prompts: Sequence[list[dict[str, str]]]
) -> float:
    if not prompts:
        raise ValueError("no prompts to compare")
    flips = sum(
        model_a.generate(prompt).text.strip() != model_b.generate(prompt).text.strip()
        for prompt in prompts
    )
    return flips / len(prompts)
