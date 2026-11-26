import re
from pathlib import Path
from typing import Any

import yaml

from modelstill.report import MARKER

REPO = Path(__file__).resolve().parents[3]
ACTION = REPO / ".github" / "actions" / "modelstill-gate" / "action.yml"
EXAMPLE = REPO / "docs" / "examples" / "modelstill-gate.yml"
PINNED = re.compile(r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$")


def _action() -> dict[str, Any]:
    return yaml.safe_load(ACTION.read_text())


def _scripts() -> str:
    return "\n".join(step.get("run", "") for step in _action()["runs"]["steps"])


def test_the_action_takes_the_gate_inputs() -> None:
    inputs = _action()["inputs"]

    assert {"spec", "history", "run", "baseline", "python-version"} <= set(inputs)
    assert all(inputs[name]["required"] for name in ("spec", "history", "run"))


def test_every_action_it_uses_is_pinned_by_commit() -> None:
    uses = [step["uses"] for step in _action()["runs"]["steps"] if "uses" in step]

    assert uses
    assert all(PINNED.match(ref) for ref in uses), uses


def test_it_runs_the_report_and_finds_its_own_comment_by_the_marker() -> None:
    scripts = _scripts()

    assert "report gate" in scripts
    assert "--format markdown" in scripts
    assert f"marker='{MARKER}'" in scripts
    assert "gh api" in scripts


def test_it_fails_the_job_only_after_commenting() -> None:
    steps = _action()["runs"]["steps"]
    names = [step.get("name", "") for step in steps]

    assert names.index("Post or update the pull-request comment") < names.index(
        "Fail when the gate fails"
    )
    assert steps[-1]["if"] == "steps.report.outputs.passed != 'true'"


def test_inputs_reach_scripts_only_through_the_environment() -> None:
    assert "${{" not in _scripts()


def test_the_example_workflow_can_comment_and_pins_checkout() -> None:
    workflow = yaml.safe_load(EXAMPLE.read_text())
    [job] = workflow["jobs"].values()

    assert workflow["permissions"]["pull-requests"] == "write"
    checkout = job["steps"][0]["uses"]
    assert PINNED.match(checkout)
    assert any("modelstill-gate" in step.get("uses", "") for step in job["steps"])
