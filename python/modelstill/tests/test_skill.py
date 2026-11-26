import re
from pathlib import Path

from cli_commands import commands, groups

from modelstill.skill import bundled_skills, main

REPO = Path(__file__).resolve().parents[3]


def _skill_text() -> str:
    [skill] = bundled_skills()
    return (skill / "SKILL.md").read_text()


def test_every_top_level_command_the_skill_names_exists() -> None:
    [skill] = bundled_skills()
    named = set(re.findall(r"`modelstill (\w+)", (skill / "SKILL.md").read_text()))
    named |= set(re.findall(r"^modelstill (\w+)", (skill / "SKILL.md").read_text(), re.M))

    assert "swap" in named
    assert named <= groups(), named - groups()


def test_the_package_ships_a_skill() -> None:
    assert _skill_text().startswith("---\nname: modelstill\n")


def test_every_command_the_skill_names_exists() -> None:
    with_actions = {group for group, _ in commands()}
    named = {
        pair
        for pair in re.findall(r"modelstill (\w+) (\w+)", _skill_text())
        if pair[0] in with_actions
    }

    assert named
    assert named <= commands(), named - commands()


def test_every_single_word_command_the_skill_names_exists() -> None:
    named = set(re.findall(r"modelstill (\w+) --", _skill_text()))

    assert "setup" in named
    assert named <= groups(), named - groups()


def test_the_skill_names_the_ci_commands() -> None:
    assert "modelstill report gate" in _skill_text()


def test_the_gate_action_the_skill_names_exists() -> None:
    paths = set(re.findall(r"\.github/actions/[\w-]+", _skill_text()))

    assert paths
    assert all((REPO / path / "action.yml").is_file() for path in paths)


def test_install_copies_the_skill_into_the_destination(tmp_path: Path) -> None:
    assert main(["--install", "--dest", str(tmp_path / "skills")]) == 0

    assert (tmp_path / "skills" / "modelstill" / "SKILL.md").is_file()


def test_installing_again_replaces_the_old_copy(tmp_path: Path) -> None:
    dest = tmp_path / "skills"
    main(["--install", "--dest", str(dest)])
    (dest / "modelstill" / "SKILL.md").write_text("old")

    main(["--install", "--dest", str(dest)])

    assert (dest / "modelstill" / "SKILL.md").read_text() != "old"
