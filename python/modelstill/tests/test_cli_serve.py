import json
from pathlib import Path

import pytest
import yaml

from modelstill.cli import main
from modelstill.stats import deferral_threshold

DEPLOYMENT = {
    "task": "technographics",
    "mode": "shadow",
    "student_model": "technographics-v1-s1",
    "threshold": None,
    "shadow_sample": 1.0,
}


def pairs(path: Path, items: list[tuple[float, bool]]) -> Path:
    path.write_text("".join(json.dumps({"confidence": c, "correct": ok}) + "\n" for c, ok in items))
    return path


def calibration() -> list[tuple[float, bool]]:
    confident = [(0.95 + i / 10_000, True) for i in range(300)]
    unsure = [(0.2 + i / 1_000, i % 2 == 0) for i in range(100)]
    return confident + unsure


def test_writes_the_threshold_into_the_deployment(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    deployment = tmp_path / "d.yaml"
    deployment.write_text(yaml.safe_dump(DEPLOYMENT))
    items = calibration()

    code = main(
        [
            "serve",
            "calibrate",
            str(pairs(tmp_path / "calib.jsonl", items)),
            "--target-error",
            "0.05",
            "--deployment",
            str(deployment),
        ]
    )

    expected = deferral_threshold([c for c, _ in items], [ok for _, ok in items], 0.05)
    assert code == 0
    assert expected.threshold is not None
    written = yaml.safe_load(deployment.read_text())
    assert written["threshold"] == expected.threshold
    assert written["mode"] == "shadow"
    out = capsys.readouterr().out
    assert f"coverage {expected.coverage:.3f}" in out
    assert f"accepted error upper bound {expected.accepted_error_upper:.4f}" in out


def test_says_so_and_clears_the_threshold_when_no_cut_off_meets_the_target(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    deployment = tmp_path / "d.yaml"
    deployment.write_text(yaml.safe_dump({**DEPLOYMENT, "threshold": 0.9}))
    bad = [(0.9, i % 2 == 0) for i in range(50)]

    code = main(
        [
            "serve",
            "calibrate",
            str(pairs(tmp_path / "c.jsonl", bad)),
            "--target-error",
            "0.05",
            "--deployment",
            str(deployment),
        ]
    )

    assert code == 0
    assert yaml.safe_load(deployment.read_text())["threshold"] is None
    assert "no threshold" in capsys.readouterr().out


def test_rejects_a_pairs_file_without_the_fields(tmp_path: Path) -> None:
    deployment = tmp_path / "d.yaml"
    deployment.write_text(yaml.safe_dump(DEPLOYMENT))
    path = tmp_path / "c.jsonl"
    path.write_text('{"score": 0.5}\n')

    code = main(
        ["serve", "calibrate", str(path), "--target-error", "0.05", "--deployment", str(deployment)]
    )

    assert code == 1
