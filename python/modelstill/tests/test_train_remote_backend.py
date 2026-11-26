import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from modelstill.train import Manifest, TrainedArtifact, TrainingPlan, load_backend
from modelstill.train.remote_backend import RemoteTrainer, is_main_process

HOST = "gpu-box"
HOME = "/home/user"


def plan(tmp_path: Path, **changes: Any) -> TrainingPlan:
    train = tmp_path / "train.jsonl"
    val = tmp_path / "val.jsonl"
    train.write_text('{"messages": []}\n')
    val.write_text('{"messages": [1]}\n')
    fields: dict[str, Any] = {
        "task": "technographics",
        "snapshot": "9256c08a" + "0" * 56,
        "base": "Qwen/Qwen3-0.6B",
        "method": "lora",
        "seed": 1,
        "train_path": train,
        "val_path": val,
        "output_root": tmp_path / "artifacts",
    }
    return TrainingPlan(**{**fields, **changes})


class FakeHost:
    def __init__(self, polls_active: int = 1, result: bool = True, ssh_failures: int = 0) -> None:
        self.commands: list[list[str]] = []
        self.stdin: list[str | None] = []
        self.polls_active = polls_active
        self.result = result
        self.ssh_failures = ssh_failures
        self.remote_plan: dict[str, Any] | None = None

    def __call__(self, command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        self.stdin.append(kwargs.get("input"))
        script = command[-1]
        if command[0] == "git":
            return subprocess.CompletedProcess(command, 0, "deadbeef\n", "")
        if command[0] == "rsync":
            if command[-1].startswith(str(Path("/"))) and ":" in command[-2]:
                self._fetch(Path(command[-1]))
            return subprocess.CompletedProcess(command, 0, "", "")
        if "is-active" in script:
            if self.ssh_failures:
                self.ssh_failures -= 1
                return subprocess.CompletedProcess(command, 255, "", "connection reset")
            if self.polls_active:
                self.polls_active -= 1
                return subprocess.CompletedProcess(command, 0, "active\n", "")
            return subprocess.CompletedProcess(command, 3, "inactive\n", "")
        if script == "echo $HOME":
            return subprocess.CompletedProcess(command, 0, HOME + "\n", "")
        if script.startswith("mkdir -p") and "cat >" in script and script.endswith(".plan.json"):
            self.remote_plan = json.loads(kwargs["input"])
            return subprocess.CompletedProcess(command, 0, "", "")
        if script.startswith("cat ") and script.endswith(".result.json"):
            if not self.result:
                return subprocess.CompletedProcess(command, 1, "", "No such file")
            return subprocess.CompletedProcess(command, 0, json.dumps(self._artifact()), "")
        if script.startswith("tail "):
            return subprocess.CompletedProcess(command, 0, "CUDA out of memory\n", "")
        return subprocess.CompletedProcess(command, 0, "", "")

    def _artifact(self) -> dict[str, Any]:
        assert self.remote_plan is not None
        remote = TrainingPlan.model_validate(self.remote_plan)
        manifest = Manifest(
            snapshot=remote.snapshot, plan={}, data={}, libraries={"trl": "1.18.2"}, python="3.12"
        )
        return TrainedArtifact(
            path=Path(f"{HOME}/modelstill/adapters/technographics/abc-s1"),
            base=remote.base,
            dtype="bfloat16",
            metrics={"eval_loss": 0.04},
            manifest=manifest,
        ).model_dump(mode="json")

    def _fetch(self, destination: Path) -> None:
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "artifact.json").write_text("{}")

    def scripts(self) -> list[str]:
        return [command[-1] for command in self.commands if command[0] == "ssh"]


def trainer(host: FakeHost, **options: Any) -> RemoteTrainer:
    package = Path("/repo/python/modelstill")
    return RemoteTrainer(host=HOST, run=host, sleep=lambda _: None, package_dir=package, **options)


def test_trains_on_the_host_and_brings_the_artifact_back(tmp_path: Path) -> None:
    host = FakeHost()
    the_plan = plan(tmp_path)

    artifact = trainer(host, gpus="1").train(the_plan)

    assert artifact.path == tmp_path / "artifacts" / "technographics" / "abc-s1"
    assert (artifact.path / "artifact.json").exists()
    assert artifact.metrics == {"eval_loss": 0.04}
    assert host.remote_plan is not None
    assert host.remote_plan["output_root"] == f"{HOME}/modelstill/adapters"
    assert host.remote_plan["train_path"].startswith(f"{HOME}/modelstill/inputs/technographics/")
    assert host.remote_plan["train_path"] != host.remote_plan["val_path"]


def test_the_package_and_inputs_are_sent_before_training(tmp_path: Path) -> None:
    host = FakeHost()

    trainer(host, gpus="1").train(plan(tmp_path))

    sends = [command for command in host.commands if command[0] == "rsync"]
    assert sends[0][-2] == "/repo/python/modelstill/"
    assert sends[0][-1] == f"{HOST}:{HOME}/modelstill/python/modelstill/"
    assert "--exclude" in sends[0]
    assert any(command[-2] == str(tmp_path / "train.jsonl") for command in sends)
    assert any("uv sync --frozen --extra train" in script for script in host.scripts())


def test_one_gpu_runs_a_single_process_detached(tmp_path: Path) -> None:
    host = FakeHost()

    trainer(host, gpus="1").train(plan(tmp_path))

    [launch] = [script for script in host.scripts() if "systemd-run" in script]
    assert "--user" in launch
    assert "CUDA_VISIBLE_DEVICES=1" in launch
    assert "accelerate launch" not in launch
    assert "python -m modelstill.train.remote_backend" in launch


def test_several_gpus_run_one_process_per_gpu(tmp_path: Path) -> None:
    host = FakeHost()

    trainer(host, gpus="0,1,2").train(plan(tmp_path))

    [launch] = [script for script in host.scripts() if "systemd-run" in script]
    assert "CUDA_VISIBLE_DEVICES=0,1,2" in launch
    assert "accelerate launch --num_processes 3" in launch


def test_a_service_holding_the_gpus_is_stopped_and_always_restarted(tmp_path: Path) -> None:
    host = FakeHost()

    trainer(host, gpus="0,1,2", stop_services=("llama-server",)).train(plan(tmp_path))

    [launch] = [script for script in host.scripts() if "systemd-run" in script]
    assert 'trap "systemctl --user start llama-server" EXIT' in launch
    assert launch.index("systemctl --user stop llama-server") > launch.index("trap")


def test_a_dropped_connection_while_waiting_does_not_abandon_the_run(tmp_path: Path) -> None:
    host = FakeHost(polls_active=1, ssh_failures=2)

    artifact = trainer(host, gpus="1").train(plan(tmp_path))

    assert artifact.metrics == {"eval_loss": 0.04}


def test_a_run_that_leaves_no_result_fails_with_the_end_of_its_log(tmp_path: Path) -> None:
    host = FakeHost(result=False)

    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        trainer(host, gpus="1").train(plan(tmp_path))


def test_lora_and_full_weight_plans_are_sent(tmp_path: Path) -> None:
    host = FakeHost()
    trainer(host, gpus="1").train(plan(tmp_path, method="full"))
    assert host.remote_plan is not None and host.remote_plan["method"] == "full"
    with pytest.raises(ValueError, match="lora or full"):
        trainer(FakeHost()).train(plan(tmp_path, method="classifier"))


def test_the_backend_is_loaded_by_name() -> None:
    loaded = load_backend("remote", host=HOST, gpus="1")

    assert isinstance(loaded, RemoteTrainer)


def test_only_rank_zero_publishes() -> None:
    assert is_main_process({})
    assert is_main_process({"RANK": "0"})
    assert not is_main_process({"RANK": "2"})


def test_the_job_records_the_commit_it_was_trained_from(tmp_path: Path) -> None:
    host = FakeHost()

    trainer(host, gpus="1").train(plan(tmp_path))

    [launch] = [script for script in host.scripts() if "systemd-run" in script]
    assert "export MODELSTILL_GIT_COMMIT=deadbeef" in launch


class FakeTunnel:
    def __init__(self) -> None:
        self.opened: list[list[str]] = []
        self.closed = 0

    def __call__(self, command: list[str]) -> "FakeTunnel":
        self.opened.append(command)
        return self

    def terminate(self) -> None:
        self.closed += 1

    def wait(self, timeout: float | None = None) -> int:
        return 0


def test_with_an_api_token_the_job_reports_to_the_console_through_a_tunnel(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MODELSTILL_API_TOKEN", "tok-123")
    monkeypatch.setenv("MODELSTILL_API_URL", "http://localhost:8787")
    monkeypatch.setenv("MODELSTILL_CONSOLE_TASK", "technographics-real")
    host = FakeHost()
    tunnel = FakeTunnel()
    package = Path("/repo/python/modelstill")
    trainer = RemoteTrainer(
        host=HOST, run=host, sleep=lambda _: None, package_dir=package, gpus="1", popen=tunnel
    )

    trainer.train(plan(tmp_path))

    [launch] = [script for script in host.scripts() if "systemd-run" in script]
    assert "tok-123" not in launch
    assert "MODELSTILL_API_URL=http://127.0.0.1:18787" in launch
    assert "MODELSTILL_CONSOLE_TASK=technographics-real" in launch
    assert "tok-123" in host.stdin
    assert tunnel.opened[0][:4] == ["ssh", "-N", "-R", "18787:localhost:8787"]
    assert tunnel.closed == 1


def test_without_an_api_token_no_tunnel_is_opened(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("MODELSTILL_API_TOKEN", raising=False)
    tunnel = FakeTunnel()
    package = Path("/repo/python/modelstill")
    trainer = RemoteTrainer(
        host=HOST, run=FakeHost(), sleep=lambda _: None, package_dir=package, popen=tunnel
    )

    trainer.train(plan(tmp_path))

    assert tunnel.opened == []
