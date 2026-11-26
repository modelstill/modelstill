import hashlib
import json
from pathlib import Path
from typing import Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ModelRef(Strict):
    model: str
    family: str


class Requirement(Strict):
    id: str
    priority: Literal["p0", "p1", "p2", "p3"]
    type: Literal["exact", "set_f1", "pass_fail", "label"]
    instruction: str


class Labelling(Strict):
    teachers: list[ModelRef] = Field(min_length=2)
    disagreement: Literal["human_queue", "drop"] = "human_queue"


class Gate(Strict):
    metric: str
    lower_ci_min: float | None = Field(default=None, ge=0, le=1)
    max_regression: float | None = Field(default=None, ge=0, le=1)
    max_flip_rate: float = Field(ge=0, le=1)
    max_cost_ratio: float = Field(gt=0)
    max_p95_latency_ms: int = Field(gt=0)

    @model_validator(mode="after")
    def has_a_quality_rule(self) -> Self:
        if self.lower_ci_min is None and self.max_regression is None:
            raise ValueError("a gate needs lower_ci_min, max_regression or both")
        return self


class Eval(Strict):
    judge: ModelRef
    golden_set: str
    gate: Gate


class Train(Strict):
    base: str
    method: Literal["lora", "full", "classifier"]
    lora_r: int | None = Field(default=None, gt=0)
    seeds: list[int] = Field(min_length=1)


class Serve(Strict):
    litellm_alias: str
    fallback: str
    target_error: float = Field(gt=0, lt=1)


class Monitor(Strict):
    canary: str
    replay_frac: float = Field(ge=0, le=1)


class TaskSpec(Strict):
    task: str = Field(pattern=r"^[a-z][a-z0-9_-]*$")
    version: int = Field(ge=1)
    instruction: str
    output_schema: str
    requirements: list[Requirement] = Field(min_length=1)
    labelling: Labelling
    eval: Eval
    train: Train
    serve: Serve
    monitor: Monitor

    @model_validator(mode="after")
    def judge_is_independent(self) -> Self:
        teacher_families = {teacher.family for teacher in self.labelling.teachers}
        if self.eval.judge.family in teacher_families:
            raise ValueError(
                f"judge family {self.eval.judge.family!r} is also a teacher family; "
                "pick a judge from another family"
            )
        return self

    @model_validator(mode="after")
    def gate_metric_is_a_requirement(self) -> Self:
        if self.eval.gate.metric not in {requirement.id for requirement in self.requirements}:
            raise ValueError(f"gate metric {self.eval.gate.metric!r} is not a requirement id")
        return self


def load_spec(path: Path) -> TaskSpec:
    return TaskSpec.model_validate(yaml.safe_load(path.read_text()))


def snapshot_hash(path: Path) -> str:
    spec = load_spec(path)
    root = path.parent
    referenced = {
        name: (root / name).read_text() for name in (spec.instruction, spec.output_schema)
    }
    canonical = json.dumps(
        {"spec": spec.model_dump(mode="json"), "files": referenced},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()
