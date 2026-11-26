import importlib
import json
from pathlib import Path

import pytest

from modelstill.train import (
    TrainedArtifact,
    flip_rate,
    load_artifact,
    load_backend,
    plans_from_spec,
)

pytestmark = [
    pytest.mark.slow,
    pytest.mark.filterwarnings("ignore::UserWarning"),
    pytest.mark.filterwarnings("ignore::DeprecationWarning"),
    pytest.mark.filterwarnings("ignore::FutureWarning"),
]

pytest.importorskip("trl", reason="needs the train extra")
local_infer = importlib.import_module("modelstill.train.local_infer")
trl_backend = importlib.import_module("modelstill.train.trl_backend")

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"
TINY = "trl-internal-testing/tiny-Qwen3ForCausalLM"
COLOURS = ["red", "blue", "green", "yellow"]


def _rows(count: int) -> str:
    lines = []
    for index in range(count):
        colour = COLOURS[index % len(COLOURS)]
        messages = [
            {"role": "system", "content": "List the colours in the sentence as a JSON array."},
            {"role": "user", "content": f"The {colour} kite number {index} flew."},
            {"role": "assistant", "content": json.dumps([colour])},
        ]
        lines.append(json.dumps({"messages": messages}))
    return "\n".join(lines) + "\n"


@pytest.fixture(scope="module")
def trained(tmp_path_factory: pytest.TempPathFactory) -> TrainedArtifact:
    root = tmp_path_factory.mktemp("trl")
    train, val = root / "train.jsonl", root / "val.jsonl"
    train.write_text(_rows(8))
    val.write_text(_rows(4))
    [plan] = plans_from_spec(
        REPO_TASK,
        train=train,
        val=val,
        output_root=root / "out",
        base=TINY,
        seeds=[1],
        max_steps=3,
        batch_size=2,
        eval_steps=2,
        max_seq_length=128,
    )
    return load_backend("trl").train(plan)


def test_training_publishes_adapter_tokenizer_chat_template_and_artifact_record(
    trained: TrainedArtifact,
) -> None:
    files = {path.name for path in trained.path.iterdir()}

    assert {"adapter_model.safetensors", "adapter_config.json", "artifact.json"} <= files
    assert {"tokenizer.json", "chat_template.jinja", "log_history.json"} <= files
    assert not any(name.startswith(("checkpoint", "_trainer")) for name in files)
    assert load_artifact(trained.path) == trained
    assert trained.dtype in {"float32", "bfloat16", "float16"}
    assert trained.manifest.libraries["trl"] == "1.18.2"


def test_training_records_train_and_eval_loss(trained: TrainedArtifact) -> None:
    assert trained.metrics["train_loss"] > 0
    assert trained.metrics["eval_loss"] > 0
    assert trained.metrics["steps"] == 3


def test_loss_covers_only_the_assistant_completion() -> None:
    record = {
        "prompt": [{"role": "user", "content": "The red kite flew."}],
        "completion": [{"role": "assistant", "content": '["red"]'}],
    }

    mask = trl_backend.completion_mask(TINY, record, max_seq_length=128)

    assert mask[0] == 0
    assert mask[-1] == 1
    assert 0 < sum(mask) < len(mask)


def test_local_model_generates_greedily_with_mean_logprob(trained: TrainedArtifact) -> None:
    model = local_infer.LocalModel.from_artifact(trained.path, max_new_tokens=8)
    messages = [{"role": "user", "content": "The red kite flew."}]

    first, second = model.generate(messages), model.generate(messages)

    assert first == second
    assert 0 < first.tokens <= 8
    assert first.mean_logprob <= 0


def test_merge_and_export_writes_fp16_weights_to_a_new_path_once(
    trained: TrainedArtifact,
) -> None:
    merged = local_infer.merge_and_export(trained.path)

    assert merged.path != trained.path
    assert merged.path.parent == trained.path.parent
    assert (merged.path / "model.safetensors").exists()
    assert (merged.kind, merged.dtype) == ("merged", "float16")
    assert load_artifact(merged.path) == merged
    with pytest.raises(FileExistsError):
        local_infer.merge_and_export(trained.path)

    prompts = [[{"role": "user", "content": f"The {colour} kite flew."}] for colour in COLOURS]
    adapter = local_infer.LocalModel.from_artifact(trained.path, max_new_tokens=4)
    fp16 = local_infer.LocalModel.from_artifact(merged.path, max_new_tokens=4)
    assert 0.0 <= flip_rate(adapter, fp16, prompts) <= 1.0
