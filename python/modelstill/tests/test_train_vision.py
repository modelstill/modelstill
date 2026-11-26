import base64
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from modelstill.train import ChatRow, plans_from_spec, read_chat_jsonl, to_prompt_completion
from modelstill.train.modal_plan import row_lengths
from modelstill.train.vision import decode_image, vision_record

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"
PNG = base64.b64encode(b"\x89PNG fake").decode()


def _row() -> dict[str, object]:
    return {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": f"data:image/png;base64,{PNG}"},
                    {"type": "text", "text": "Which tools are on this slide?"},
                ],
            },
            {"role": "assistant", "content": '{"technologies": []}'},
        ]
    }


def test_chat_rows_accept_image_and_text_parts(tmp_path: Path) -> None:
    path = tmp_path / "rows.jsonl"
    path.write_text(json.dumps(_row()) + "\n")

    [row] = read_chat_jsonl(path)

    content: Any = to_prompt_completion(row)["prompt"][0]["content"]
    assert content[1]["text"].startswith("Which")


def test_an_image_part_needs_an_image() -> None:
    bad = _row()
    bad["messages"][0]["content"][0] = {"type": "image"}  # pyright: ignore[reportIndexIssue]

    with pytest.raises(ValueError):
        ChatRow.model_validate(bad)


def test_a_data_url_decodes_to_its_bytes() -> None:
    assert decode_image(f"data:image/png;base64,{PNG}") == b"\x89PNG fake"


def test_a_vision_record_moves_images_out_of_the_messages() -> None:
    record = vision_record(ChatRow.model_validate(_row()))

    assert record["images"] == [b"\x89PNG fake"]
    assert record["prompt"][0]["content"][0] == {"type": "image"}
    assert record["completion"] == [
        {"role": "assistant", "content": [{"type": "text", "text": '{"technologies": []}'}]}
    ]


def test_vision_plans_say_so(tmp_path: Path) -> None:
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    [plan] = plans_from_spec(
        REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1], modality="vision",
        base="Qwen/Qwen3-VL-2B-Instruct",
    )  # fmt: skip

    assert plan.modality == "vision"


def test_an_image_counts_towards_the_estimated_row_length(tmp_path: Path) -> None:
    with_image = tmp_path / "image.jsonl"
    with_image.write_text(json.dumps(_row()) + "\n")
    text = _row()
    text["messages"][0]["content"] = "Which tools are on this slide?"  # pyright: ignore[reportIndexIssue]
    text_only = tmp_path / "text.jsonl"
    text_only.write_text(json.dumps(text) + "\n")

    assert row_lengths(with_image, 8192)[0] > row_lengths(text_only, 8192)[0] + 500


def test_image_inputs_train_with_sft_only_for_now(tmp_path: Path) -> None:
    rows = tmp_path / "rows.jsonl"
    rows.write_text("")
    with pytest.raises(ValidationError, match="vision"):
        plans_from_spec(
            REPO_TASK, train=rows, val=rows, output_root=tmp_path, seeds=[1], modality="vision",
            method="grpo", rl={"reward": "exact_match"},
        )  # fmt: skip
