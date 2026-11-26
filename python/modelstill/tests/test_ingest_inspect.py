import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

from modelstill.ingest.inspect_logs import load, value_to_float

FIXTURE = Path(__file__).parent / "fixtures" / "ingest" / "inspect_log.json"


def log() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text())


def eval_zip(path: Path, header_name: str = "header.json") -> Path:
    data = log()
    samples = data.pop("samples")
    with zipfile.ZipFile(path, "w") as archive:
        if header_name == "header.json":
            archive.writestr("header.json", json.dumps(data))
        else:
            start = {"version": 2, "eval": data["eval"], "plan": data["plan"]}
            archive.writestr("_journal/start.json", json.dumps(start))
        archive.writestr("summaries.json", "[]")
        for sample in samples:
            name = f"samples/{sample['id']}_epoch_{sample['epoch']}.json"
            archive.writestr(name, json.dumps(sample))
    return path


def test_value_to_float_follows_inspect() -> None:
    assert value_to_float("C") == 1.0
    assert value_to_float("I") == 0.0
    assert value_to_float("P") == 0.5
    assert value_to_float("N") == 0.0
    assert value_to_float("yes") == 1.0
    assert value_to_float("false") == 0.0
    assert value_to_float(True) == 1.0
    assert value_to_float(3) == 3.0
    assert value_to_float("0.25") == 0.25
    with pytest.raises(ValueError, match="maybe"):
        value_to_float("maybe")


def check(run_cases: dict[str, Any]) -> None:
    first, second, third = run_cases["1"], run_cases["2"], run_cases["three"]
    assert first.score == pytest.approx(0.5)
    assert first.metrics == pytest.approx({"judge.relevance": 0.8, "judge.style": 0.75})
    assert first.input == "We use Python and dbt."
    assert first.expected == "python, dbt"
    assert first.output == "python, dbt"
    assert first.latency_ms == pytest.approx(1300)
    assert second.score == 1.0
    assert second.metrics == {"judge.relevance": 1.0, "judge.style": 1.0}
    assert second.input == [{"role": "user", "content": "Excel at sales."}]
    assert third.score == pytest.approx(0.25)
    assert third.error == "TimeoutError: model did not answer"


def test_a_json_log_averages_epochs_per_sample() -> None:
    run = load(FIXTURE)

    assert run.model == "openai/gpt-5-mini"
    assert run.source == "inspect"
    check({case.id: case for case in run.cases})


def test_an_eval_archive_reads_the_header_and_every_sample(tmp_path: Path) -> None:
    run = load(eval_zip(tmp_path / "2026-11-20_technographics.eval"))

    assert run.model == "openai/gpt-5-mini"
    check({case.id: case for case in run.cases})


def test_an_unfinished_archive_falls_back_to_the_journal_start(tmp_path: Path) -> None:
    run = load(eval_zip(tmp_path / "running.eval", header_name="start"), model="candidate")

    assert run.model == "candidate"
    assert len(run.cases) == 3


def test_another_scorer_or_one_of_its_keys_can_be_the_case_score() -> None:
    run = load(FIXTURE, scorer="judge.relevance")

    by_id = {case.id: case for case in run.cases}
    assert by_id["1"].score == pytest.approx(0.8)
    assert "match" in by_id["1"].metrics
    assert "three" not in by_id or by_id["three"].score == 0.0


def test_other_scorers_with_non_numeric_values_are_left_out(tmp_path: Path) -> None:
    data = log()
    data["samples"][0]["scores"]["choice"] = {"value": "B"}
    path = tmp_path / "log.json"
    path.write_text(json.dumps(data))

    by_id = {case.id: case for case in load(path).cases}

    assert "choice" not in by_id["1"].metrics


def test_a_dict_scorer_needs_a_key(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"judge\.relevance"):
        load(FIXTURE, scorer="judge")
