import json
import shlex
from pathlib import Path

import pytest

from modelstill.benchmark import History, load_benchmark
from modelstill.cli import main

TASK = Path("tasks") / "ticket-priority-example"


def _commands(printed: str) -> list[list[str]]:
    joined = printed.replace("\\\n", " ")
    return [
        shlex.split(line.strip())[1:]
        for line in joined.splitlines()
        if line.strip().startswith("modelstill report gate")
    ]


def _quickstart(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> str:
    assert main(["quickstart", str(tmp_path / "demo")]) == 0
    return capsys.readouterr().out


def test_quickstart_writes_a_valid_example_task(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _quickstart(tmp_path, capsys)

    assert main(["spec", "validate", str(tmp_path / "demo" / TASK / "spec.yaml")]) == 0
    benchmark = load_benchmark(tmp_path / "demo" / TASK / "data" / "golden.jsonl")
    assert 200 <= len(benchmark.cases) <= 300
    assert {case.expected for case in benchmark.cases} == {"urgent", "normal", "low"}


def test_quickstart_records_three_runs_and_accepts_the_baseline(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _quickstart(tmp_path, capsys)

    history = History(tmp_path / "demo" / "history.jsonl")
    benchmark = load_benchmark(tmp_path / "demo" / TASK / "data" / "golden.jsonl")
    assert [entry.model for entry in history.runs()] == ["prompt-v1", "prompt-v2", "prompt-v3"]
    accepted = history.last_accepted(benchmark)
    assert accepted is not None
    assert accepted.model == "prompt-v1"


def test_the_printed_gate_commands_pass_one_candidate_and_fail_the_other(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert main(["quickstart", "demo"]) == 0
    passing, failing = _commands(capsys.readouterr().out)

    assert main(passing) == 0
    assert "### ModelStill gate: passed" in capsys.readouterr().out
    assert main(failing) == 2
    assert "### ModelStill gate: failed" in capsys.readouterr().out


def test_the_failing_candidate_breaks_the_data_exposure_cluster(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    main(["quickstart", "demo"])
    _, failing = _commands(capsys.readouterr().out)

    assert main([*failing, "--format", "json"]) == 2
    decision = json.loads(capsys.readouterr().out)
    [regression] = [
        check for check in decision["checks"] if check["name"] == "regression_vs_baseline"
    ]
    assert not regression["passed"]
    assert [check["passed"] for check in decision["checks"] if check is not regression] == [
        True,
        True,
        True,
    ]
    benchmark = load_benchmark(tmp_path / "demo" / TASK / "data" / "golden.jsonl")
    tags = {case.id: case.tags for case in benchmark.cases}
    assert all("data-exposure" in tags[item["case_id"]] for item in decision["regressions"])


def test_quickstart_says_the_data_is_an_example(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    printed = _quickstart(tmp_path, capsys)

    assert "example data" in printed.lower()
    assert "example data" in (tmp_path / "demo" / "README.md").read_text().lower()


def test_quickstart_is_deterministic(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["quickstart", str(tmp_path / "one")]) == 0
    assert main(["quickstart", str(tmp_path / "two")]) == 0
    capsys.readouterr()

    golden = TASK / "data" / "golden.jsonl"
    assert (tmp_path / "one" / golden).read_text() == (tmp_path / "two" / golden).read_text()
    ids = [
        [entry.id for entry in History(tmp_path / name / "history.jsonl").runs()]
        for name in ("one", "two")
    ]
    assert ids[0] == ids[1]


def test_quickstart_writes_into_an_empty_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "demo").mkdir()

    assert main(["quickstart", str(tmp_path / "demo")]) == 0
    assert (tmp_path / "demo" / "history.jsonl").is_file()


def test_quickstart_refuses_a_non_empty_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "demo").mkdir()
    (tmp_path / "demo" / "notes.txt").write_text("mine")

    assert main(["quickstart", str(tmp_path / "demo")]) == 1
    assert "not empty" in capsys.readouterr().err
    assert [path.name for path in (tmp_path / "demo").iterdir()] == ["notes.txt"]


def test_quickstart_refuses_a_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "demo").write_text("mine")

    assert main(["quickstart", str(tmp_path / "demo")]) == 1
    assert "not empty" in capsys.readouterr().err


def test_the_documented_commands_match_what_quickstart_prints(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = Path(__file__).resolve().parents[3]
    monkeypatch.chdir(tmp_path)
    main(["quickstart", "demo"])
    printed = capsys.readouterr().out
    passing = printed.split("exit code 0):\n\n")[1].split("\n\n")[0]
    failing = printed.split("exit code 2):\n\n")[1].split("\n\n")[0]

    docs = (repo / "apps" / "docs" / "content" / "docs" / "quickstart.mdx").read_text()
    assert printed.strip() in docs
    assert failing in docs
    for readme in (repo / "README.md", repo / "python" / "modelstill" / "README.md"):
        assert passing in readme.read_text()
