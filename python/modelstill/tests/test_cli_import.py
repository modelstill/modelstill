import json
from pathlib import Path

import pytest
import yaml

from modelstill.benchmark import History
from modelstill.cli import main

FIXTURES = Path(__file__).parent / "fixtures" / "ingest"
GATE = {
    "metric": "tools",
    "max_regression": 0.5,
    "max_flip_rate": 0.05,
    "max_cost_ratio": 1.5,
    "max_p95_latency_ms": 5000,
}


def gate_file(tmp_path: Path, **changes: object) -> Path:
    path = tmp_path / "gate.yaml"
    path.write_text(yaml.safe_dump({**GATE, **changes}))
    return path


def test_import_deepeval_records_a_run(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    history = tmp_path / "runs.jsonl"

    code = main(
        [
            "import",
            "deepeval",
            str(FIXTURES / "deepeval_test_run.json"),
            "--history",
            str(history),
            "--task",
            "technographics",
        ]
    )

    assert code == 0
    [entry] = History(history).runs()
    assert entry.model == "gpt-5-mini"
    assert entry.benchmark == "technographics"
    assert len(entry.result.scores) == 4
    assert "Answer Relevancy" in entry.metrics
    assert f"recorded {entry.id[:8]} gpt-5-mini: 0.500" in capsys.readouterr().out


def test_a_deepeval_file_is_compared_and_gated_against_the_accepted_baseline(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    history = tmp_path / "runs.jsonl"
    source = FIXTURES / "deepeval_test_run.json"
    base = ["import", "deepeval", str(source), "--history", str(history), "--task", "tech"]
    assert main([*base, "--accept"]) == 0
    worse = json.loads(source.read_text())
    worse["testCases"][0]["success"] = False
    candidate = tmp_path / "candidate.json"
    candidate.write_text(json.dumps(worse))
    capsys.readouterr()

    gated = [
        "import",
        "deepeval",
        str(candidate),
        "--history",
        str(history),
        "--task",
        "tech",
        "--model",
        "candidate",
        "--gate",
        str(gate_file(tmp_path, max_regression=0.0)),
        "--flip-rate",
        "0",
        "--cost-ratio",
        "1",
    ]
    code = main(gated)

    out = capsys.readouterr().out
    assert code == 1
    assert "vs baseline" in out and "broken 1" in out
    assert "regression_vs_baseline" in out and "gate FAILED" in out
    [gate] = History(history).gates()
    assert gate["report"]["passed"] is False


def test_the_gate_needs_the_values_it_cannot_measure(tmp_path: Path) -> None:
    code = main(
        [
            "import",
            "deepeval",
            str(FIXTURES / "deepeval_test_run.json"),
            "--history",
            str(tmp_path / "runs.jsonl"),
            "--task",
            "tech",
            "--gate",
            str(gate_file(tmp_path)),
        ]
    )

    assert code == 1
    assert History(tmp_path / "runs.jsonl").runs() == []


def test_import_inspect_uses_the_chosen_scorer(tmp_path: Path) -> None:
    history = tmp_path / "runs.jsonl"

    code = main(
        [
            "import",
            "inspect",
            str(FIXTURES / "inspect_log.json"),
            "--history",
            str(history),
            "--task",
            "tech",
            "--scorer",
            "judge.relevance",
        ]
    )

    assert code == 0
    [entry] = History(history).runs()
    assert entry.model == "openai/gpt-5-mini"
    assert "match" in entry.metrics


def test_import_promptfoo_records_one_run_per_provider_and_gates_each(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    history = tmp_path / "runs.jsonl"
    source = str(FIXTURES / "promptfoo_results.json")
    common = ["import", "promptfoo", source, "--history", str(history), "--task", "tech"]
    assert main([*common, "--provider", "openai:gpt-5-mini", "--accept"]) == 0

    code = main(
        [
            *common,
            "--gate",
            str(gate_file(tmp_path, lower_ci_min=0.0, max_regression=1.0)),
            "--flip-rate",
            "0",
            "--cost-ratio",
            "0.2",
        ]
    )

    assert code == 1
    models = [entry.model for entry in History(history).runs()]
    assert models == ["openai:gpt-5-mini", "openai:gpt-5-mini", "Qwen student"]
    out = capsys.readouterr().out
    assert out.count("gate passed") == 1
    assert out.count("gate FAILED") == 1
    assert "p95_latency_ms: 30010 (limit 5000) FAILED" in out


def test_accept_needs_a_single_run(tmp_path: Path) -> None:
    code = main(
        [
            "import",
            "promptfoo",
            str(FIXTURES / "promptfoo_results.json"),
            "--history",
            str(tmp_path / "runs.jsonl"),
            "--task",
            "tech",
            "--accept",
        ]
    )

    assert code == 1
