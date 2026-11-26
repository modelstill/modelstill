import json
from pathlib import Path

import pytest

from modelstill import cli
from modelstill.attest import ATTESTATION_FILE, build_attestation, verify
from modelstill.train import Manifest

MANIFEST = Manifest(snapshot="s" * 64, plan={"seed": 1}, data={}, libraries={}, python="3.12")


def files(tmp_path: Path) -> dict[str, Path]:
    train = tmp_path / "train.jsonl"
    val = tmp_path / "val.jsonl"
    train.write_text('{"a": 1}\n{"a": 2}\n')
    val.write_text('{"a": 3}\n')
    return {"train": train, "val": val}


def test_an_attestation_names_every_file_by_hash_and_rows(tmp_path: Path) -> None:
    attestation = build_attestation(MANIFEST, files(tmp_path), git_commit="abc123")

    assert attestation["manifest_digest"] == MANIFEST.digest()
    assert attestation["git_commit"] == "abc123"
    assert attestation["files"]["train"]["rows"] == 2
    assert attestation["files"]["val"]["rows"] == 1
    assert len(attestation["files"]["train"]["sha256"]) == 64
    assert attestation["files"]["train"]["row_root"] != attestation["files"]["val"]["row_root"]


def test_the_same_files_verify(tmp_path: Path) -> None:
    named = files(tmp_path)
    attestation = build_attestation(MANIFEST, named, git_commit="")

    assert verify(attestation, named) == []


def test_one_changed_byte_is_reported(tmp_path: Path) -> None:
    named = files(tmp_path)
    attestation = build_attestation(MANIFEST, named, git_commit="")
    named["train"].write_text('{"a": 1}\n{"a": 9}\n')

    assert verify(attestation, named) == ["train: sha256 differs"]


def test_a_file_the_attestation_does_not_know_is_reported(tmp_path: Path) -> None:
    named = files(tmp_path)
    attestation = build_attestation(MANIFEST, {"train": named["train"]}, git_commit="")

    assert verify(attestation, named) == ["val: not in the attestation"]


def test_attest_verify_exits_non_zero_on_a_mismatch(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    named = files(tmp_path)
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    (artifact / ATTESTATION_FILE).write_text(json.dumps(build_attestation(MANIFEST, named, "")))

    assert cli.main(["attest", "verify", str(artifact), "--train", str(named["train"])]) == 0
    named["train"].write_text("changed\n")
    assert cli.main(["attest", "verify", str(artifact), "--train", str(named["train"])]) == 1
    assert "sha256 differs" in capsys.readouterr().out
