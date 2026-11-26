import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from modelstill import cli
from modelstill.export import RemoteExporter, export_peft
from modelstill.train import Manifest, TrainedArtifact

HOME = "/home/user"
MANIFEST = Manifest(snapshot="s" * 64, plan={}, data={}, libraries={}, python="3.12")


def artifact(tmp_path: Path, kind: str = "adapter") -> Path:
    path = tmp_path / "artifacts" / "technographics" / "9256c08a-a41fcbab-s1"
    path.mkdir(parents=True)
    TrainedArtifact(
        path=path, base="Qwen/Qwen3-0.6B", dtype="bfloat16", metrics={}, manifest=MANIFEST,
        kind=kind,  # pyright: ignore[reportArgumentType]
    ).write(path)  # fmt: skip
    (path / "adapter_model.safetensors").write_bytes(b"weights")
    (path / "adapter_config.json").write_text("{}")
    return path


def test_a_peft_export_is_a_copy_of_the_adapter(tmp_path: Path) -> None:
    out = tmp_path / "out"

    export_peft(artifact(tmp_path), out)

    assert (out / "adapter_model.safetensors").read_bytes() == b"weights"
    assert (out / "artifact.json").exists()


def test_an_export_never_overwrites(tmp_path: Path) -> None:
    source = artifact(tmp_path)
    out = tmp_path / "out"
    out.mkdir()

    with pytest.raises(FileExistsError):
        export_peft(source, out)


def test_a_merged_model_is_not_a_peft_adapter(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="adapter"):
        export_peft(artifact(tmp_path, kind="merged"), tmp_path / "out")


class FakeHost:
    def __init__(self) -> None:
        self.commands: list[list[str]] = []

    def __call__(self, command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        script = command[-1]
        if command[0] == "rsync":
            if command[-1].startswith("/") and ":" in command[-2]:
                Path(command[-1]).mkdir(parents=True)
                (Path(command[-1]) / "model.gguf").write_bytes(b"gguf")
            return subprocess.CompletedProcess(command, 0, "", "")
        if script == "echo $HOME":
            return subprocess.CompletedProcess(command, 0, HOME + "\n", "")
        if "is-active" in script:
            return subprocess.CompletedProcess(command, 3, "inactive\n", "")
        if script.endswith(".result.json") and script.startswith("cat "):
            out = f"{HOME}/modelstill/exports/out/9256c08a-a41fcbab-s1-gguf"
            return subprocess.CompletedProcess(command, 0, json.dumps({"path": out}), "")
        return subprocess.CompletedProcess(command, 0, "", "")

    def launches(self) -> list[str]:
        return [c[-1] for c in self.commands if c[0] == "ssh" and "systemd-run" in c[-1]]


def test_a_gguf_export_runs_on_the_host_and_comes_back(tmp_path: Path) -> None:
    host = FakeHost()
    exporter = RemoteExporter(
        "gpu-box", run=host, sleep=lambda _: None, package_dir=Path("/repo/python/modelstill")
    )

    out = exporter.export(artifact(tmp_path), "gguf", tmp_path / "out", outtype="q8_0")

    assert (out / "model.gguf").read_bytes() == b"gguf"
    [launch] = host.launches()
    assert "python -m modelstill.export gguf" in launch
    assert "--outtype q8_0" in launch
    assert "--llama-cpp" in launch
    sent = [c for c in host.commands if c[0] == "rsync" and c[-2].endswith("s1/")]
    assert sent and sent[0][-1].endswith("/exports/in/9256c08a-a41fcbab-s1/")


def test_merged_and_gguf_exports_need_a_gpu_host(tmp_path: Path) -> None:
    code = cli.main(
        ["export", str(artifact(tmp_path)), "--to", "gguf", "--out", str(tmp_path / "o")]
    )

    assert code == 1


def test_the_cli_writes_a_peft_export(tmp_path: Path) -> None:
    out = tmp_path / "o"

    assert cli.main(["export", str(artifact(tmp_path)), "--to", "peft", "--out", str(out)]) == 0
    assert (out / "adapter_config.json").exists()
