import json
from pathlib import Path

import pytest

from modelstill.ingest.deepeval import load

FIXTURE = Path(__file__).parent / "fixtures" / "ingest" / "deepeval_test_run.json"


def test_test_cases_become_pass_fail_cases_with_their_metric_scores() -> None:
    run = load(FIXTURE)

    assert run.model == "gpt-5-mini"
    assert run.source == "deepeval"
    by_id = {case.id: case for case in run.cases}
    assert set(by_id) == {"test_case_0", "test_case_1", "test_case_2", "conversational_test_case_0"}
    first = by_id["test_case_0"]
    assert first.score == 1.0
    assert first.input == "We use Python and dbt on Snowflake."
    assert first.expected == "python, dbt, snowflake"
    assert first.output == "python, dbt, snowflake"
    assert first.metrics == {"Answer Relevancy": 0.92, "Correctness (GEval)": 1.0}
    assert first.latency_ms == pytest.approx(840)
    assert by_id["test_case_1"].score == 0.0
    errored = by_id["test_case_2"]
    assert errored.score == 0.0
    assert errored.error == "Answer Relevancy: RateLimitError: judge was rate limited"
    assert errored.metrics == {}


def test_conversational_cases_keep_their_turns() -> None:
    [chat] = [case for case in load(FIXTURE).cases if case.id.startswith("conversational")]

    assert chat.input == [
        {"role": "user", "content": "Which tools does Acme use?"},
        {"role": "assistant", "content": "Python and dbt."},
    ]
    assert chat.expected == "The assistant names the tools."
    assert chat.metrics == {"Conversation Completeness": 0.75}


def test_the_latest_run_wrapper_and_a_model_override_are_supported(tmp_path: Path) -> None:
    wrapped = tmp_path / ".latest_test_run.json"
    wrapped.write_text(json.dumps({"testRunData": json.loads(FIXTURE.read_text())}))

    run = load(wrapped, model="candidate")

    assert run.model == "candidate"
    assert len(run.cases) == 4


def test_duplicate_names_fall_back_to_content_ids(tmp_path: Path) -> None:
    data = json.loads(FIXTURE.read_text())
    for case in data["testCases"]:
        case["name"] = "test_extracts_tools"
    path = tmp_path / "run.json"
    path.write_text(json.dumps(data))

    ids = [case.id for case in load(path).cases]

    assert len(set(ids)) == 4
    assert all(case_id.startswith("test_extracts_tools:") for case_id in ids[:3])
