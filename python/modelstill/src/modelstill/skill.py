import argparse
import shutil
from collections.abc import Sequence
from importlib.resources import as_file, files
from pathlib import Path

__all__ = ["bundled_skills", "main"]


def bundled_skills() -> list[Path]:
    root = Path(str(files("modelstill") / "skills"))
    return sorted(entry for entry in root.iterdir() if (entry / "SKILL.md").is_file())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m modelstill.skill",
        description="Print or install the coding-agent skill bundled with modelstill.",
    )
    parser.add_argument("--install", action="store_true", help="copy the skill into --dest")
    parser.add_argument("--dest", type=Path, default=Path.home() / ".claude" / "skills")
    args = parser.parse_args(argv)
    with as_file(files("modelstill") / "skills"):
        skills = bundled_skills()
        if not args.install:
            for skill in skills:
                print(skill)
            return 0
        args.dest.mkdir(parents=True, exist_ok=True)
        for skill in skills:
            target = args.dest / skill.name
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(skill, target)
            print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
