from pathlib import Path

import pytest

from modelstill.cli import main

REPO_TASK = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"


EXAMPLE_TASK = Path(__file__).resolve().parents[3] / "tasks" / "ticket-priority" / "spec.yaml"


def test_validate_accepts_the_fixture_task(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["spec", "validate", str(REPO_TASK)]) == 0
    assert "technographics v1 ok" in capsys.readouterr().out


def test_the_example_task_shipped_in_the_repository_is_valid(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["spec", "validate", str(EXAMPLE_TASK)]) == 0
    assert "ticket-priority v1 ok" in capsys.readouterr().out


def test_validate_reports_an_invalid_spec(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = tmp_path / "spec.yaml"
    broken.write_text(REPO_TASK.read_text().replace("version: 1", "version: 1\nmystery: 1"))

    assert main(["spec", "validate", str(broken)]) == 1
    assert "mystery" in capsys.readouterr().err


def test_hash_prints_a_sha256(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["spec", "hash", str(REPO_TASK)]) == 0
    printed = capsys.readouterr().out.strip()
    assert len(printed) == 64
    assert all(character in "0123456789abcdef" for character in printed)
