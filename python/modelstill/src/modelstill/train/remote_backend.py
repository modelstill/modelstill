import json
import os
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from modelstill.remote import RemoteHost, Run
from modelstill.train import TRAINABLE, TrainedArtifact, TrainingPlan, file_sha256

__all__ = ["RemoteTrainer", "backend", "is_main_process", "main"]

_JOB = "modelstill.train.remote_backend"
CONSOLE_PORT = 18787


def is_main_process(env: dict[str, str] | None = None) -> bool:
    return (env if env is not None else os.environ).get("RANK", "0") == "0"


class RemoteTrainer:
    def __init__(
        self,
        host: str,
        gpus: str = "0",
        stop_services: Sequence[str] = (),
        workdir: str = "modelstill",
        poll_seconds: float = 60,
        run: Run = subprocess.run,
        sleep: Callable[[float], None] = time.sleep,
        package_dir: Path | None = None,
        popen: Callable[[list[str]], Any] = subprocess.Popen,
    ) -> None:
        self._popen = popen
        self.gpus = [gpu.strip() for gpu in gpus.split(",") if gpu.strip()]
        self.stop_services = tuple(stop_services)
        self.remote = RemoteHost(host, workdir, poll_seconds, run, sleep, package_dir)

    def train(self, plan: TrainingPlan) -> TrainedArtifact:
        if plan.method not in TRAINABLE:
            raise ValueError(f"the remote backend trains lora or full plans, not {plan.method!r}")
        workspace = self.remote.prepare()
        inputs = f"{workspace.root}/inputs/{plan.task}"
        remote_files: dict[str, str] = {}
        for field in ("train_path", "val_path"):
            local: Path = getattr(plan, field)
            remote_files[field] = f"{inputs}/{file_sha256(local)}.jsonl"
            self.remote.send(local, remote_files[field])
        remote_plan = plan.model_copy(
            update={
                "train_path": Path(remote_files["train_path"]),
                "val_path": Path(remote_files["val_path"]),
                "output_root": Path(f"{workspace.root}/adapters"),
            }
        )
        run_id = f"{plan.task}-s{plan.seed}-{uuid.uuid4().hex[:8]}"
        prefix = f"{workspace.root}/runs/{run_id}"
        self.remote.write(f"{prefix}.plan.json", remote_plan.model_dump_json())
        workspace = self.remote.install(workspace)
        env, env_files, tunnel = self._console(workspace.root)
        try:
            result = self.remote.run_job(
                workspace,
                unit=f"modelstill-train-{run_id}",
                prefix=prefix,
                module=_JOB,
                args=[f"{prefix}.plan.json"],
                gpus=self.gpus,
                stop_services=self.stop_services,
                env=env,
                env_files=env_files,
            )
        finally:
            if tunnel is not None:
                tunnel.terminate()
                tunnel.wait(timeout=10)
        artifact = TrainedArtifact.model_validate_json(result)
        local = plan.output_root / plan.task / artifact.path.name
        self.remote.fetch_dir(str(artifact.path), local)
        return artifact.model_copy(update={"path": local})

    def _console(self, root: str) -> tuple[dict[str, str], dict[str, str], Any]:
        token = os.environ.get("MODELSTILL_API_TOKEN")
        if not token:
            return {}, {}, None
        api = urlparse(os.environ.get("MODELSTILL_API_URL") or "http://localhost:8787")
        token_file = f"{root}/console.token"
        self.remote.write(token_file, token)
        self.remote.checked(f"chmod 600 {token_file}")
        tunnel = self._popen(
            [
                "ssh", "-N", "-R", f"{CONSOLE_PORT}:{api.hostname}:{api.port or 80}",
                "-o", "ExitOnForwardFailure=yes", "-o", "BatchMode=yes", self.remote.host,
            ]
        )  # fmt: skip
        env = {"MODELSTILL_API_URL": f"http://127.0.0.1:{CONSOLE_PORT}"}
        if task := os.environ.get("MODELSTILL_CONSOLE_TASK"):
            env["MODELSTILL_CONSOLE_TASK"] = task
        return env, {"MODELSTILL_API_TOKEN": token_file}, tunnel


def backend(
    host: str,
    gpus: str = "0",
    stop_services: Sequence[str] = (),
    poll_seconds: float = 60,
) -> RemoteTrainer:
    return RemoteTrainer(host, gpus=gpus, stop_services=stop_services, poll_seconds=poll_seconds)


def main(argv: Sequence[str] | None = None) -> None:
    plan_file, result_file = argv if argv is not None else sys.argv[1:]
    from modelstill.train import trl_backend  # noqa: PLC0415

    plan = TrainingPlan.model_validate_json(Path(plan_file).read_text())
    artifact = trl_backend.backend().train(plan)
    if is_main_process():
        partial = Path(f"{result_file}.partial")
        partial.write_text(json.dumps(artifact.model_dump(mode="json")))
        partial.replace(result_file)


if __name__ == "__main__":
    main()
