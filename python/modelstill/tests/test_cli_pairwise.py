from pathlib import Path
from typing import Any

import pytest
import yaml
from fake_openai import FakeOpenAI

from modelstill.benchmark import Benchmark, History
from modelstill.cli import main
from modelstill.evals import Case, exact_match, run

BENCH = Benchmark(name="tech", cases=tuple(Case(str(i), i, "yes") for i in range(40)))


def two_runs(path: Path) -> tuple[str, str]:
    history = History(path)
    weak = run(BENCH.cases, model=lambda i: "yes" if i % 2 else "no", metric=exact_match)
    strong = run(BENCH.cases, model=lambda i: "yes", metric=exact_match)
    return history.record(BENCH, "student-v1", weak), history.record(BENCH, "student-v2", strong)


def prefers_yes(body: dict[str, Any]) -> str:
    text = body["messages"][-1]["content"]
    first = text.split("Answer A:\n", 1)[1].split("\n\nAnswer B:\n", 1)[0]
    second = text.split("Answer B:\n", 1)[1]
    if first == second:
        return "TIE"
    return "A" if first == "yes" else "B"


def spec_file(tmp_path: Path, judge_family: str) -> Path:
    path = tmp_path / "spec.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "task": "tech",
                "version": 1,
                "instruction": "prompt.md",
                "output_schema": "schema.json",
                "requirements": [
                    {"id": "tools", "priority": "p0", "type": "exact", "instruction": "x"}
                ],
                "labelling": {
                    "teachers": [
                        {"model": "gpt-5-mini", "family": "openai"},
                        {"model": "qwen3-235b", "family": "qwen"},
                    ]
                },
                "eval": {
                    "judge": {"model": "gemma-4-judge", "family": judge_family},
                    "golden_set": "golden.jsonl",
                    "gate": {
                        "metric": "tools",
                        "max_regression": 0.0,
                        "max_flip_rate": 0.05,
                        "max_cost_ratio": 1.5,
                        "max_p95_latency_ms": 5000,
                    },
                },
                "train": {"base": "qwen3-4b", "method": "lora", "seeds": [0]},
                "serve": {"litellm_alias": "tech", "fallback": "gpt-5-mini", "target_error": 0.05},
                "monitor": {"canary": "canary.jsonl", "replay_frac": 0.01},
            }
        )
    )
    return path


def test_eval_pairwise_judges_both_orders_and_reports_an_exact_interval(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    before, after = two_runs(path)
    monkeypatch.setenv("JUDGE_KEY", "test-key")

    with FakeOpenAI("gemma-4-judge", prefers_yes) as server:
        code = main(
            [
                "eval",
                "pairwise",
                str(path),
                before,
                after,
                "--spec",
                str(spec_file(tmp_path, "gemma")),
                "--base-url",
                server.url,
                "--api-key-env",
                "JUDGE_KEY",
            ]
        )

    assert code == 0
    assert len(server.requests) == 80
    assert {request["model"] for request in server.requests} == {"gemma-4-judge"}
    assert {request["temperature"] for request in server.requests} == {0}
    out = capsys.readouterr().out
    assert "student-v2 wins 20, student-v1 wins 0, ties 20" in out
    assert "win rate 1.000 [0.832, 1.000]" in out
    assert "better" in out
    assert "inconsistent 0 (0.000 [0.000, 0.088])" in out


def test_eval_pairwise_refuses_a_judge_from_a_teacher_family(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    before, after = two_runs(path)

    code = main(
        [
            "eval",
            "pairwise",
            str(path),
            before,
            after,
            "--spec",
            str(spec_file(tmp_path, "qwen")),
            "--base-url",
            "http://127.0.0.1:9",
        ]
    )

    assert code == 1
    assert "teacher" in capsys.readouterr().err


def test_eval_pairwise_without_a_spec_needs_the_judge_and_teacher_families(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    before, after = two_runs(path)
    base = ["eval", "pairwise", str(path), before, after, "--base-url", "http://127.0.0.1:9"]

    assert main([*base, "--judge-model", "gemma-4", "--judge-family", "gemma"]) == 1
    assert "--teacher-family" in capsys.readouterr().err
    assert main([*base, "--teacher-family", "qwen"]) == 1
    assert "--judge-model" in capsys.readouterr().err
    flagged = [
        *base,
        "--judge-model",
        "qwen3-judge",
        "--judge-family",
        "qwen",
        "--teacher-family",
        "qwen",
    ]
    assert main(flagged) == 1
    assert "teacher" in capsys.readouterr().err
