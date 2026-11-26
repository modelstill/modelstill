import importlib.util
import json
from pathlib import Path
from typing import Any

import fake_modal
import pytest

from modelstill.train import served_name

APP_FILE = Path(__file__).resolve().parents[3] / "deploy" / "modal" / "modelstill_student.py"
REF = "technographics/1a2b3c4d-5e6f7a8b-s1"


def _load(monkeypatch: pytest.MonkeyPatch, adapters: str = REF, gpu: str | None = None) -> Any:
    fake_modal.install(monkeypatch)
    monkeypatch.setenv("MODELSTILL_ADAPTERS", adapters)
    if gpu is None:
        monkeypatch.delenv("MODELSTILL_SERVE_GPU", raising=False)
    else:
        monkeypatch.setenv("MODELSTILL_SERVE_GPU", gpu)
    spec = importlib.util.spec_from_file_location("modelstill_student", APP_FILE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _artifact(root: Path, ref: str, base: str = "Qwen/Qwen3-1.7B", rank: int = 16, **extra: Any):
    directory = root / ref
    directory.mkdir(parents=True)
    (directory / "artifact.json").write_text(json.dumps({"base": base, "kind": "adapter", **extra}))
    (directory / "adapter_config.json").write_text(json.dumps({"r": rank}))
    return directory


def test_the_app_scales_to_zero_caps_concurrency_and_names_its_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _load(monkeypatch)
    serve = app.app.functions["serve"]
    options = serve.options

    assert options["gpu"] == "A10G"
    assert options["min_containers"] == 0
    assert (options["cpu"], options["memory"]) == (2.0, 16 * 1024)
    assert options["max_containers"] == 1
    assert 0 < options["scaledown_window"] <= 600
    assert [secret.name for secret in options["secrets"]] == ["modelstill-student-auth"]
    assert options["volumes"]["/artifacts"].name == "modelstill-artifacts"
    assert options["volumes"]["/artifacts"].create_if_missing is False
    kinds = dict(serve.decorators)
    assert kinds["web_server"]["port"] == app.PORT
    assert kinds["concurrent"]["max_inputs"] == app.MAX_CONCURRENT_REQUESTS


def test_the_image_pins_vllm_and_transformers_exactly_and_carries_the_adapter_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _load(monkeypatch, gpu="L4")
    image = app.app.functions["serve"].options["image"]

    assert image.packages() == ["vllm==0.34.0", "transformers==5.22.2"]
    assert image.environment()["MODELSTILL_ADAPTERS"] == REF
    assert image.environment()["MODELSTILL_SERVE_GPU"] == "L4"
    assert app.app.functions["serve"].options["gpu"] == "L4"


def test_deploying_without_adapters_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="MODELSTILL_ADAPTERS"):
        _load(monkeypatch, adapters=" , ")
    with pytest.raises(ValueError, match="task/version"):
        _load(monkeypatch, adapters="technographics/../secrets")


def test_adapters_are_read_from_the_volume_with_base_rank_and_versioned_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _load(monkeypatch)
    other = "technographics/9f8e7d6c-5b4a3c2d-s2"
    _artifact(tmp_path, REF)
    _artifact(tmp_path, other, rank=32)

    adapters = app.read_adapters(tmp_path, [REF, other])

    assert [adapter.name for adapter in adapters] == [
        served_name(tmp_path / REF),
        served_name(tmp_path / other),
    ]
    assert adapters[0].name == "technographics-1a2b3c4d-5e6f7a8b-s1"
    assert {adapter.base for adapter in adapters} == {"Qwen/Qwen3-1.7B"}
    assert [adapter.rank for adapter in adapters] == [16, 32]


def test_adapters_must_share_one_base_and_be_adapters(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _load(monkeypatch)
    _artifact(tmp_path, "a/one", base="Qwen/Qwen3-1.7B")
    _artifact(tmp_path, "a/two", base="Qwen/Qwen3-4B")
    _artifact(tmp_path, "a/merged", kind="merged")

    with pytest.raises(ValueError, match="one base"):
        app.read_adapters(tmp_path, ["a/one", "a/two"])
    with pytest.raises(ValueError, match="alone"):
        app.read_adapters(tmp_path, ["a/one", "a/merged"])
    with pytest.raises(FileNotFoundError):
        app.read_adapters(tmp_path, ["a/missing"])


def test_a_merged_model_is_served_alone_under_its_own_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _load(monkeypatch)
    _artifact(tmp_path, "technographics/full-s1", kind="merged")

    command = app.vllm_command(app.read_adapters(tmp_path, ["technographics/full-s1"]))

    assert command[:3] == ["vllm", "serve", str(tmp_path / "technographics/full-s1")]
    assert command[command.index("--served-model-name") + 1] == "technographics-full-s1"
    assert "--enable-lora" not in command


def test_the_vllm_command_enables_lora_logprobs_and_no_thinking(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _load(monkeypatch)
    _artifact(tmp_path, REF, rank=12)
    _artifact(tmp_path, "technographics/x-y-s2", rank=16)

    command = app.vllm_command(app.read_adapters(tmp_path, [REF, "technographics/x-y-s2"]))

    assert command[:3] == ["vllm", "serve", "Qwen/Qwen3-1.7B"]

    def value(flag: str) -> str:
        return command[command.index(flag) + 1]

    assert "--enable-lora" in command
    assert value("--max-lora-rank") == "16"
    assert value("--max-loras") == "2"
    assert int(value("--max-logprobs")) >= 1
    assert json.loads(value("--default-chat-template-kwargs")) == {"enable_thinking": False}
    assert (value("--host"), value("--port")) == ("0.0.0.0", str(app.PORT))
    modules = [
        json.loads(command[i + 1]) for i, flag in enumerate(command) if flag == "--lora-modules"
    ]
    assert modules[0] == {
        "name": "technographics-1a2b3c4d-5e6f7a8b-s1",
        "path": str(tmp_path / REF),
        "base_model_name": "Qwen/Qwen3-1.7B",
    }
    assert len(modules) == 2
    assert "--api-key" not in command


def test_serve_refuses_to_start_without_the_auth_key_and_otherwise_starts_vllm(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    app = _load(monkeypatch)
    _artifact(tmp_path / "adapters", REF)
    monkeypatch.setattr(app, "ARTIFACTS_MOUNT", str(tmp_path))
    started: list[list[str]] = []
    monkeypatch.setattr(app.subprocess, "Popen", lambda command: started.append(command))
    serve = app.app.functions["serve"]

    monkeypatch.delenv("VLLM_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="VLLM_API_KEY"):
        serve()
    assert started == []

    monkeypatch.setenv("VLLM_API_KEY", "test-key")
    serve()
    [command] = started
    assert "technographics-1a2b3c4d-5e6f7a8b-s1" in command[command.index("--lora-modules") + 1]
