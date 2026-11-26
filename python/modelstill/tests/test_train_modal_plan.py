import json
import math
import tomllib
from pathlib import Path
from typing import Any

import pytest

from modelstill.train import TrainingPlan, plans_from_spec, served_name
from modelstill.train.modal_plan import (
    CPU_CORE_PER_HOUR,
    DEFAULT_GPU,
    GPU_PRICES_PER_HOUR,
    MEMORY_GIB_PER_HOUR,
    dry_run,
    estimate,
    expected_padded_length,
    image_requirements,
    params_billions,
    volume_plan,
)

ROOT = Path(__file__).resolve().parents[1]
REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"


def _rows(path: Path, count: int, chars: int) -> Path:
    row = {
        "messages": [
            {"role": "user", "content": "x" * chars},
            {"role": "assistant", "content": "[]"},
        ]
    }
    path.write_text("".join(json.dumps(row) + "\n" for _ in range(count)))
    return path


def _plan(tmp_path: Path, rows: int = 2400, chars: int = 20_000, **settings: Any) -> TrainingPlan:
    train = _rows(tmp_path / "train.jsonl", rows, chars)
    val = _rows(tmp_path / "val.jsonl", 100, chars)
    return plans_from_spec(
        REPO_TASK, train=train, val=val, output_root=tmp_path / "out", seeds=[1], **settings
    )[0]


def test_image_pins_exactly_the_core_and_train_extra_versions() -> None:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    expected = sorted([*project["dependencies"], *project["optional-dependencies"]["train"]])

    assert sorted(image_requirements()) == expected
    assert all("==" in requirement for requirement in image_requirements())


def test_modal_extra_pins_the_sdk_exactly() -> None:
    extras = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"][
        "optional-dependencies"
    ]
    [sdk] = extras["modal"]
    assert sdk.startswith("modal==")


def test_parameter_count_is_read_from_the_base_name() -> None:
    assert params_billions("Qwen/Qwen3-1.7B") == 1.7
    assert params_billions("Qwen/Qwen3-4B") == 4.0
    assert params_billions("Qwen/Qwen3-0.6B-Base") == 0.6
    with pytest.raises(ValueError, match="parameter count"):
        params_billions("some/model")


def test_expected_padded_length_is_the_mean_batch_maximum() -> None:
    assert expected_padded_length([5, 5, 5], batch=4) == 5
    assert expected_padded_length([1, 2], batch=1) == 1.5
    assert expected_padded_length([1, 2], batch=2) == pytest.approx(1.75)


def test_estimate_caps_rows_at_max_length_and_counts_steps_and_evals(tmp_path: Path) -> None:
    plan = _plan(tmp_path, max_seq_length=4096)

    result = estimate(plan, gpu="L40S")

    assert result.rows == 2400
    assert result.tokens_per_row == 4096
    assert result.steps == 1800
    assert result.evals == 37
    assert result.gpu == "L40S"
    assert result.hours > 0
    hourly = GPU_PRICES_PER_HOUR["L40S"] + result.cpu * CPU_CORE_PER_HOUR
    hourly += result.memory_gib * MEMORY_GIB_PER_HOUR
    assert result.cost_usd == pytest.approx(result.hours * hourly, rel=1e-6)
    assert result.max_cost_usd == pytest.approx(result.timeout_minutes / 60 * hourly, rel=1e-6)
    assert result.timeout_minutes >= math.ceil(result.hours * 60)


def test_a_bigger_base_costs_more_and_max_steps_bounds_the_run(tmp_path: Path) -> None:
    small = estimate(_plan(tmp_path, max_seq_length=4096), gpu="L40S")
    big = estimate(_plan(tmp_path, max_seq_length=4096, base="Qwen/Qwen3-4B"), gpu="L40S")
    capped = estimate(_plan(tmp_path, max_seq_length=4096, max_steps=10), gpu="L40S")

    assert big.cost_usd > small.cost_usd
    assert capped.steps == 10
    assert capped.cost_usd < small.cost_usd


def test_l40s_is_the_default_and_cheaper_per_run_than_a10g(tmp_path: Path) -> None:
    plan = _plan(tmp_path, max_seq_length=4096)

    assert DEFAULT_GPU == "L40S"
    assert estimate(plan, gpu="L40S").cost_usd < estimate(plan, gpu="A10G").cost_usd


def test_an_explicit_timeout_sets_the_spend_cap_and_unknown_gpus_are_refused(
    tmp_path: Path,
) -> None:
    plan = _plan(tmp_path)

    assert estimate(plan, gpu="L40S", timeout_minutes=90).timeout_minutes == 90
    with pytest.raises(ValueError, match="unknown GPU"):
        estimate(plan, gpu="Z9000")
    with pytest.raises(ValueError, match="24 hours"):
        estimate(plan, gpu="L40S", timeout_minutes=25 * 60)


def test_volume_plan_puts_inputs_by_content_hash_and_outputs_under_adapters(
    tmp_path: Path,
) -> None:
    plan = _plan(tmp_path, rows=3, chars=10)

    layout = volume_plan(plan)

    assert layout.train_remote.startswith("inputs/technographics/")
    assert layout.train_remote.endswith(".jsonl")
    assert layout.train_remote != layout.val_remote
    assert layout.plan.output_root == Path("/artifacts/adapters")
    assert layout.plan.train_path == Path("/artifacts") / layout.train_remote
    assert layout.plan_remote.startswith("plans/technographics/")
    assert json.loads(layout.plan_json())["train_path"] == str(layout.plan.train_path)


def test_dry_run_reports_plan_gpu_timeout_and_cost(tmp_path: Path) -> None:
    plan = _plan(tmp_path, max_seq_length=4096)

    report = dry_run(plan, gpu="L40S", timeout_minutes=120)

    assert report["backend"] == "modal"
    assert report["gpu"] == "L40S"
    assert report["gpu_usd_per_hour"] == GPU_PRICES_PER_HOUR["L40S"]
    assert report["timeout_minutes"] == 120
    assert isinstance(report["plan"], dict)
    assert report["plan"]["base"] == "Qwen/Qwen3-1.7B"
    assert report["volume"] == "modelstill-artifacts"
    assert {"estimated_hours", "estimated_cost_usd", "max_cost_usd", "assumptions"} <= set(report)


def test_served_name_is_task_and_versioned_directory() -> None:
    path = Path("/artifacts/adapters/technographics/1a2b3c4d-5e6f7a8b-s1")
    assert served_name(path) == "technographics-1a2b3c4d-5e6f7a8b-s1"


def test_full_weight_training_needs_far_more_gpu_memory_than_lora(tmp_path: Path) -> None:
    rows = _rows(tmp_path / "rows.jsonl", 10, 100)
    [lora] = plans_from_spec(REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1])
    full = lora.model_copy(update={"method": "full"})

    assert estimate(full).gpu_memory_gib > 4 * estimate(lora).gpu_memory_gib


def test_four_bit_lora_needs_less_gpu_memory_than_bf16_lora(tmp_path: Path) -> None:
    rows = _rows(tmp_path / "rows.jsonl", 10, 100)
    [lora] = plans_from_spec(
        REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1], base="Qwen/Qwen3-8B"
    )
    quantized = lora.model_copy(update={"quantization": "4bit"})

    assert estimate(quantized).gpu_memory_gib < estimate(lora).gpu_memory_gib / 2
