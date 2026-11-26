import json
import shlex
import subprocess
import time
from collections.abc import Callable, Sequence
from pathlib import Path

from modelstill.remote import RemoteHost, Run
from modelstill.train import load_artifact, served_name

__all__ = ["HostServer", "vllm_args"]

MAX_MODEL_LEN = 8192
MAX_LOGPROBS = 5
LORA_RANKS = (8, 16, 32, 64, 128, 256, 320, 512)


def vllm_args(
    base: str, models: Sequence[tuple[str, str, int]], host: str, port: int, merged: bool
) -> list[str]:
    args = [
        "serve", base,
        "--host", host,
        "--port", str(port),
        "--dtype", "bfloat16",
        "--max-model-len", str(MAX_MODEL_LEN),
        "--max-logprobs", str(MAX_LOGPROBS),
        "--default-chat-template-kwargs", json.dumps({"enable_thinking": False}),
    ]  # fmt: skip
    if merged:
        return [*args, "--served-model-name", models[0][0]]
    rank = next(value for value in LORA_RANKS if value >= max(model[2] for model in models))
    args += ["--enable-lora", "--max-lora-rank", str(rank), "--max-loras", str(len(models))]
    for name, path, _ in models:
        args += [
            "--lora-modules",
            json.dumps({"name": name, "path": path, "base_model_name": base}),
        ]
    return args


class HostServer:
    def __init__(
        self,
        host: str,
        workdir: str = "modelstill",
        poll_seconds: float = 15,
        max_polls: int = 60,
        run: Run = subprocess.run,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.remote = RemoteHost(host, workdir, poll_seconds, run, sleep)
        self.poll_seconds = poll_seconds
        self.max_polls = max_polls
        self._sleep = sleep

    @staticmethod
    def unit(port: int) -> str:
        return f"modelstill-serve-{port}"

    def up(
        self,
        artifacts: Sequence[Path],
        gpu: str,
        port: int,
        api_key: str,
        stop_services: Sequence[str] = (),
    ) -> list[str]:
        found = [load_artifact(path) for path in artifacts]
        bases = {artifact.base for artifact in found}
        if len(bases) != 1:
            raise ValueError(f"a server holds one base model; these use {sorted(bases)}")
        merged = [artifact.kind == "merged" for artifact in found]
        if any(merged) and len(found) > 1:
            raise ValueError("a merged model is served alone")
        root = f"{self.remote.checked('echo $HOME').strip()}/{self.remote.workdir}"
        models: list[tuple[str, str, int]] = []
        for path in artifacts:
            remote = f"{root}/adapters/{path.parent.name}/{path.name}"
            if self.remote.ssh(f"test -d {shlex.quote(remote)}").returncode != 0:
                self.remote.send_dir(path, remote)
            config = path / "adapter_config.json"
            rank = int(json.loads(config.read_text())["r"]) if config.exists() else 0
            models.append((served_name(path), remote, rank))
        key_file = f"{root}/serve/api.key"
        self.remote.write(key_file, api_key)
        self.remote.checked(f"chmod 600 {shlex.quote(key_file)}")
        base = models[0][1] if merged[0] else found[0].base
        args = vllm_args(base, models, host="127.0.0.1", port=port, merged=merged[0])
        devices = [device for device in gpu.split(",") if device.strip()]
        if len(devices) > 1:
            args += ["--tensor-parallel-size", str(len(devices))]
        vllm = f"{root}/serve/.venv/bin/vllm"
        lines = [f'trap "systemctl --user start {service}" EXIT' for service in stop_services]
        lines += [f"systemctl --user stop {service}" for service in stop_services]
        lines += [
            f"export CUDA_VISIBLE_DEVICES={gpu}",
            f'export VLLM_API_KEY="$(cat {shlex.quote(key_file)})"',
            f"{vllm} {' '.join(shlex.quote(arg) for arg in args)} "
            f"> {shlex.quote(root)}/serve/{port}.log 2>&1",
        ]
        self.remote.checked(
            f"systemd-run --user --unit={self.unit(port)} --collect bash -c "
            + shlex.quote("\n".join(lines))
        )
        for _ in range(self.max_polls):
            self._sleep(self.poll_seconds)
            if self.remote.ssh(f"curl -sf -m 5 http://127.0.0.1:{port}/health").returncode == 0:
                return [model[0] for model in models]
        tail = self.remote.ssh(f"tail -n 30 {shlex.quote(root)}/serve/{port}.log").stdout
        raise RuntimeError(f"vLLM on port {port} did not become healthy; end of its log:\n{tail}")

    def down(self, port: int) -> None:
        self.remote.checked(f"systemctl --user stop {self.unit(port)}")
