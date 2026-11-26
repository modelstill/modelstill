import re
from collections.abc import Sequence
from pathlib import Path

import pytest
from cli_commands import commands

from modelstill import setup
from modelstill.cli import main


class Launcher:
    def __init__(self, found: set[str]) -> None:
        self.found = found
        self.calls: list[list[str]] = []

    def which(self, name: str) -> str | None:
        return f"/bin/{name}" if name in self.found else None

    def run(self, command: Sequence[str]) -> int:
        self.calls.append(list(command))
        return 0


@pytest.fixture
def launcher(monkeypatch: pytest.MonkeyPatch) -> Launcher:
    fake = Launcher(found={"claude", "codex"})
    monkeypatch.setattr(setup, "which", fake.which)
    monkeypatch.setattr(setup, "launch", fake.run)
    return fake


def test_the_prompt_points_at_the_bundled_skill() -> None:
    prompt = setup.prompt()

    skill = re.search(r"(\S+SKILL\.md)", prompt)
    assert skill is not None
    assert Path(skill.group(1).strip("`")).is_file()
    assert "tasks/<task>/spec.yaml" in prompt


def test_the_prompt_names_only_real_commands() -> None:
    named = set(re.findall(r"modelstill (\w+) (\w+)", setup.prompt()))

    assert {("spec", "validate"), ("report", "gate")} <= named
    assert named <= commands(), named - commands()


def test_the_prompt_forbids_secrets_and_running_the_app() -> None:
    prompt = setup.prompt().lower()

    assert "secret" in prompt
    assert "do not run the application" in prompt


def test_the_prompt_sends_the_agent_to_the_skills_ci_gate_section() -> None:
    assert "CI gate" in setup.prompt()
    assert "## CI gate" in setup.skill_path().read_text()


def test_the_prompt_is_short() -> None:
    assert len(setup.prompt().split()) < 250


def test_print_is_the_default_and_launches_nothing(
    launcher: Launcher, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["setup"]) == 0

    assert capsys.readouterr().out == setup.prompt()
    assert launcher.calls == []


def test_claude_runs_headless_with_the_prompt(launcher: Launcher) -> None:
    assert main(["setup", "--agent", "claude"]) == 0

    [call] = launcher.calls
    assert call[0] == "/bin/claude"
    assert "-p" in call
    assert call[-1] == setup.prompt()


def test_codex_runs_exec_with_the_prompt(launcher: Launcher) -> None:
    assert main(["setup", "--agent", "codex"]) == 0

    [call] = launcher.calls
    assert call[:2] == ["/bin/codex", "exec"]
    assert call[-1] == setup.prompt()


def test_a_missing_agent_prints_the_prompt_instead(
    launcher: Launcher, capsys: pytest.CaptureFixture[str]
) -> None:
    launcher.found = set()

    assert main(["setup", "--agent", "codex"]) == 0

    captured = capsys.readouterr()
    assert captured.out == setup.prompt()
    assert "codex" in captured.err
    assert launcher.calls == []


def test_setup_writes_nothing(
    launcher: Launcher, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)

    main(["setup", "--agent", "claude"])
    main(["setup"])

    assert list(tmp_path.iterdir()) == []
