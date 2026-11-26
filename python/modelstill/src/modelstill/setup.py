import subprocess
import sys
from collections.abc import Sequence
from importlib.resources import files
from pathlib import Path
from shutil import which

AGENTS: dict[str, tuple[str, ...]] = {
    "claude": ("-p", "--permission-mode", "acceptEdits"),
    "codex": ("exec", "--sandbox", "workspace-write"),
}
CHOICES = ("print", *AGENTS)


def skill_path() -> Path:
    return Path(str(files("modelstill") / "skills" / "modelstill" / "SKILL.md"))


def prompt() -> str:
    template = Path(str(files("modelstill") / "setup_prompt.md")).read_text()
    return template.replace("{skill}", str(skill_path()))


def launch(command: Sequence[str]) -> int:
    return subprocess.run(list(command), check=False).returncode


def run_setup(agent: str) -> int:
    text = prompt()
    binary = None if agent == "print" else which(agent)
    if binary is None:
        if agent != "print":
            print(
                f"{agent} is not on PATH; paste this prompt into your coding agent", file=sys.stderr
            )
        print(text, end="")
        return 0
    return launch([binary, *AGENTS[agent], text])
