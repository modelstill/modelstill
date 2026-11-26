import json
from pathlib import Path

import pytest

from modelstill.ingest.promptfoo import load

FIXTURE = Path(__file__).parent / "fixtures" / "ingest" / "promptfoo_results.json"


def test_every_provider_prompt_column_becomes_its_own_run() -> None:
    gpt, qwen = load(FIXTURE)

    assert gpt.model == "openai:gpt-5-mini"
    assert qwen.model == "Qwen student"
    assert gpt.source == "promptfoo"
    assert [case.id for case in gpt.cases] == ["python and dbt", "excel homograph", "kubernetes"]


def test_cases_carry_pass_fail_scores_named_scores_and_latency() -> None:
    gpt, qwen = load(FIXTURE)
    first, repeated, third = gpt.cases

    assert first.score == 1.0
    assert first.input == {"text": "We use Python and dbt."}
    assert first.expected == [{"type": "icontains-all", "value": ["python", "dbt"]}]
    assert first.output == "python, dbt"
    assert first.metrics == {"score": 1.0, "tools": 1.0}
    assert first.latency_ms == 820
    assert repeated.score == pytest.approx(0.5)
    assert repeated.latency_ms == pytest.approx(650)
    assert third.metrics == {"score": 0.75}
    failed = qwen.cases[2]
    assert failed.score == 0.0
    assert failed.error == "API error: 503 Service Unavailable"
    assert failed.output is None


def test_one_provider_can_be_picked_and_bare_summaries_are_read(tmp_path: Path) -> None:
    bare = tmp_path / "summary.json"
    bare.write_text(json.dumps(json.loads(FIXTURE.read_text())["results"]))

    [run] = load(bare, provider="openai:chat:qwen3-4b")

    assert run.model == "Qwen student"
    with pytest.raises(ValueError, match="no results for provider"):
        load(FIXTURE, provider="missing")


def test_one_provider_with_several_prompts_names_each_prompt(tmp_path: Path) -> None:
    data = json.loads(FIXTURE.read_text())
    for row in data["results"]["results"]:
        row["provider"] = {"id": "openai:gpt-5-mini", "label": ""}
        row["prompt"]["label"] = f"prompt-{row['promptIdx']}"
    path = tmp_path / "results.json"
    path.write_text(json.dumps(data))

    assert [run.model for run in load(path)] == [
        "openai:gpt-5-mini [prompt-0]",
        "openai:gpt-5-mini [prompt-1]",
    ]


def test_tests_without_unique_descriptions_use_their_index(tmp_path: Path) -> None:
    data = json.loads(FIXTURE.read_text())
    for row in data["results"]["results"]:
        row["testCase"].pop("description")
    path = tmp_path / "results.json"
    path.write_text(json.dumps(data))

    gpt, _ = load(path)

    assert [case.id for case in gpt.cases] == ["test-0", "test-1", "test-2"]
