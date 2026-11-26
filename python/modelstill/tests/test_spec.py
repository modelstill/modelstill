from pathlib import Path

import pytest
from pydantic import ValidationError

from modelstill.spec import TaskSpec, load_spec, snapshot_hash

VALID = """
task: technographics
version: 1
instruction: prompts/system.md
output_schema: schemas/out.json
requirements:
  - id: correct_technologies
    priority: p0
    type: set_f1
    instruction: Every technology named in the posting, and nothing else.
labelling:
  teachers:
    - {model: deepseek/deepseek-v4-flash, family: deepseek}
    - {model: qwen/qwen3.7-flash, family: qwen}
  disagreement: human_queue
eval:
  judge: {model: google/gemma-4-27b, family: gemma}
  golden_set: data/golden.jsonl
  gate:
    metric: correct_technologies
    lower_ci_min: 0.90
    max_flip_rate: 0.01
    max_cost_ratio: 0.60
    max_p95_latency_ms: 4000
train:
  base: Qwen/Qwen3-1.7B
  method: lora
  lora_r: 16
  seeds: [1, 2, 3]
serve:
  litellm_alias: technographics
  fallback: technographics-cloud
  target_error: 0.05
monitor:
  canary: data/canary.jsonl
  replay_frac: 0.3
"""


def write_task(tmp_path: Path, text: str = VALID) -> Path:
    (tmp_path / "prompts").mkdir()
    (tmp_path / "prompts" / "system.md").write_text("Extract technologies.")
    (tmp_path / "schemas").mkdir()
    (tmp_path / "schemas" / "out.json").write_text('{"type": "object"}')
    path = tmp_path / "technographics.yaml"
    path.write_text(text)
    return path


def test_loads_a_valid_spec(tmp_path: Path) -> None:
    spec = load_spec(write_task(tmp_path))

    assert isinstance(spec, TaskSpec)
    assert spec.task == "technographics"
    assert spec.labelling.teachers[1].family == "qwen"
    assert spec.eval.gate.lower_ci_min == 0.90
    assert spec.train.seeds == [1, 2, 3]


def test_rejects_unknown_keys(tmp_path: Path) -> None:
    path = write_task(tmp_path, VALID.replace("version: 1", "version: 1\nmystery: true"))

    with pytest.raises(ValidationError, match="mystery"):
        load_spec(path)


def test_rejects_unknown_nested_keys(tmp_path: Path) -> None:
    path = write_task(tmp_path, VALID.replace("lora_r: 16", "lora_r: 16\n  lora_alpha: 32"))

    with pytest.raises(ValidationError, match="lora_alpha"):
        load_spec(path)


def test_rejects_a_judge_from_a_teacher_family(tmp_path: Path) -> None:
    path = write_task(
        tmp_path,
        VALID.replace("{model: google/gemma-4-27b, family: gemma}", "{model: x/y, family: qwen}"),
    )

    with pytest.raises(ValidationError, match="judge"):
        load_spec(path)


def test_rejects_a_single_teacher(tmp_path: Path) -> None:
    path = write_task(
        tmp_path,
        VALID.replace("    - {model: qwen/qwen3.7-flash, family: qwen}\n", ""),
    )

    with pytest.raises(ValidationError, match="teachers"):
        load_spec(path)


def test_snapshot_hash_ignores_key_order(tmp_path: Path) -> None:
    first = tmp_path / "a"
    second = tmp_path / "b"
    first.mkdir()
    second.mkdir()
    reordered = VALID.replace(
        "task: technographics\nversion: 1", "version: 1\ntask: technographics"
    )

    assert snapshot_hash(write_task(first)) == snapshot_hash(write_task(second, reordered))


def test_snapshot_hash_changes_when_a_prompt_file_changes(tmp_path: Path) -> None:
    path = write_task(tmp_path)
    before = snapshot_hash(path)
    (tmp_path / "prompts" / "system.md").write_text("Extract technologies, carefully.")

    assert snapshot_hash(path) != before


def test_missing_prompt_file_is_an_error(tmp_path: Path) -> None:
    path = write_task(tmp_path)
    (tmp_path / "prompts" / "system.md").unlink()

    with pytest.raises(FileNotFoundError):
        snapshot_hash(path)
