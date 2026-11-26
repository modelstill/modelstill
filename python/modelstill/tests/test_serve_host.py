import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from modelstill import cli
from modelstill.serve.host import HostServer, vllm_args
from modelstill.train import Manifest, TrainedArtifact

HOME = "/home/user"
MANIFEST = Manifest(snapshot="s" * 64, plan={}, data={}, libraries={}, python="3.12")


def artifact(root: Path, name: str, kind: str = "adapter", rank: int = 16) -> Path:
    path = root / "technographics" / name
    path.mkdir(parents=True)
    TrainedArtifact(
        path=path, base="Qwen/Qwen3-4B", dtype="bfloat16", metrics={}, manifest=MANIFEST,
        kind=kind,  # pyright: ignore[reportArgumentType]
    ).write(path)  # fmt: skip
    (path / "adapter_config.json").write_text(json.dumps({"r": rank}))
    return path


class FakeHost:
    def __init__(self, healthy_after: int = 1) -> None:
        self.commands: list[list[str]] = []
        self.inputs: list[str | None] = []
        self.healthy_after = healthy_after

    def __call__(self, command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        self.inputs.append(kwargs.get("input"))
        script = command[-1]
        if script == "echo $HOME":
            return subprocess.CompletedProcess(command, 0, HOME + "\n", "")
        if "/health" in script:
            self.healthy_after -= 1
            code = 0 if self.healthy_after <= 0 else 7
            return subprocess.CompletedProcess(command, code, "", "")
        if script.startswith("test -d"):
            return subprocess.CompletedProcess(command, 1, "", "")
        return subprocess.CompletedProcess(command, 0, "", "")

    def scripts(self) -> list[str]:
        return [c[-1] for c in self.commands if c[0] == "ssh"]


def server(host: FakeHost) -> HostServer:
    return HostServer("gpu-box", run=host, sleep=lambda _: None, poll_seconds=0)


def test_vllm_args_match_the_modal_deployment() -> None:
    args = vllm_args(
        "Qwen/Qwen3-4B", [("tech-a", "/a", 16)], host="127.0.0.1", port=8100, merged=False
    )

    assert args[:3] == ["serve", "Qwen/Qwen3-4B", "--host"]
    assert "--enable-lora" in args
    assert args[args.index("--max-lora-rank") + 1] == "16"
    assert args[args.index("--max-model-len") + 1] == "8192"
    assert json.loads(args[args.index("--default-chat-template-kwargs") + 1]) == {
        "enable_thinking": False
    }
    assert json.loads(args[args.index("--lora-modules") + 1])["name"] == "tech-a"


def test_a_merged_model_is_served_under_its_own_name() -> None:
    args = vllm_args("/m", [("tech-full", "/m", 0)], host="127.0.0.1", port=8100, merged=True)

    assert args[1] == "/m"
    assert args[args.index("--served-model-name") + 1] == "tech-full"
    assert "--enable-lora" not in args


def test_up_sends_missing_adapters_starts_vllm_and_waits_for_health(tmp_path: Path) -> None:
    host = FakeHost(healthy_after=3)
    local = artifact(tmp_path, "9256c08a-a41fcbab-s1")

    served = server(host).up([local], gpu="1", port=8100, api_key="secret")

    assert served == ["technographics-9256c08a-a41fcbab-s1"]
    [launch] = [s for s in host.scripts() if "systemd-run" in s]
    assert "--unit=modelstill-serve-8100" in launch
    assert "CUDA_VISIBLE_DEVICES=1" in launch
    assert "127.0.0.1" in launch
    assert "secret" not in launch
    assert "secret" in host.inputs
    assert any(c[0] == "rsync" and c[-2] == f"{local}/" for c in host.commands)
    assert sum("/health" in s for s in host.scripts()) == 3


def test_adapters_on_different_bases_cannot_share_a_server(tmp_path: Path) -> None:
    a = artifact(tmp_path, "a-s1")
    b = artifact(tmp_path / "other", "b-s1")
    data = json.loads((b / "artifact.json").read_text())
    (b / "artifact.json").write_text(json.dumps({**data, "base": "Qwen/Qwen3-1.7B"}))

    with pytest.raises(ValueError, match="one base"):
        server(FakeHost()).up([a, b], gpu="1", port=8100, api_key="k")


def test_down_stops_the_unit(tmp_path: Path) -> None:
    host = FakeHost()

    server(host).down(port=8100)

    assert host.scripts() == ["systemctl --user stop modelstill-serve-8100"]


def test_serve_up_needs_a_key_file(tmp_path: Path) -> None:
    local = artifact(tmp_path, "x-s1")
    code = cli.main(
        ["serve", "up", str(local), "--host", "h", "--key-file", str(tmp_path / "missing")]
    )

    assert code == 1


def test_several_gpus_split_one_model_with_tensor_parallelism(tmp_path: Path) -> None:
    host = FakeHost()

    server(host).up([artifact(tmp_path, "big-s1")], gpu="0,1", port=8100, api_key="k")

    [launch] = [s for s in host.scripts() if "systemd-run" in s]
    assert "CUDA_VISIBLE_DEVICES=0,1" in launch
    assert "--tensor-parallel-size 2" in launch


def test_one_gpu_needs_no_tensor_parallelism(tmp_path: Path) -> None:
    host = FakeHost()

    server(host).up([artifact(tmp_path, "small-s1")], gpu="1", port=8100, api_key="k")

    [launch] = [s for s in host.scripts() if "systemd-run" in s]
    assert "--tensor-parallel-size" not in launch
