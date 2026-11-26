import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from modelstill.train import Manifest

__all__ = ["ATTESTATION_FILE", "GIT_COMMIT_ENV", "build_attestation", "load_attestation", "verify"]

ATTESTATION_FILE = "attestation.json"
GIT_COMMIT_ENV = "MODELSTILL_GIT_COMMIT"


def _describe(path: Path) -> dict[str, Any]:
    whole = hashlib.sha256()
    rows = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        for line in stream:
            whole.update(line)
            if line.strip():
                rows.update(hashlib.sha256(line.rstrip(b"\n")).digest())
                count += 1
    return {"sha256": whole.hexdigest(), "rows": count, "row_root": rows.hexdigest()}


def build_attestation(
    manifest: Manifest, files: Mapping[str, Path], git_commit: str
) -> dict[str, Any]:
    return {
        "version": 1,
        "manifest_digest": manifest.digest(),
        "snapshot": manifest.snapshot,
        "git_commit": git_commit,
        "files": {name: _describe(path) for name, path in sorted(files.items())},
    }


def load_attestation(artifact: Path) -> dict[str, Any]:
    return json.loads((artifact / ATTESTATION_FILE).read_text())


def verify(attestation: Mapping[str, Any], files: Mapping[str, Path]) -> list[str]:
    problems: list[str] = []
    known: Mapping[str, Mapping[str, Any]] = attestation["files"]
    for name, path in sorted(files.items()):
        if name not in known:
            problems.append(f"{name}: not in the attestation")
            continue
        if _describe(path)["sha256"] != known[name]["sha256"]:
            problems.append(f"{name}: sha256 differs")
    return problems
