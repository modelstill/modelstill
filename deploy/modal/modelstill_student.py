# pyright: reportMissingImports=false

import json
import os
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import modal

APP_NAME = "modelstill-student"
VLLM_VERSION = "0.34.0"
TRANSFORMERS_VERSION = "5.22.2"
PYTHON_VERSION = "3.12"
VOLUME_NAME = "modelstill-artifacts"
HF_CACHE_VOLUME_NAME = "modelstill-hf-cache"
SECRET_NAME = "modelstill-student-auth"
ARTIFACTS_MOUNT = "/artifacts"
HF_CACHE_MOUNT = "/hf-cache"
PORT = 8000
DEFAULT_GPU = "A10G"
CPU_CORES = 2.0
MEMORY_GIB = 16

MAX_MODEL_LEN = 8192
"""Prompts of up to about 4k tokens plus the 2,000 answer tokens the benchmark client allows."""

MAX_LOGPROBS = 5
"""The gateway asks for `logprobs: true` (the chosen token's log-probability); a few alternatives
are allowed for confidence rules that read `top_logprobs`."""

MAX_CONCURRENT_REQUESTS = 32
"""Requests one container takes at once; vLLM batches them on the GPU."""

MAX_CONTAINERS = 1
"""A hard cap on parallel GPUs, so a traffic spike queues instead of multiplying the bill."""

SCALEDOWN_SECONDS = 300
"""Idle seconds before the container stops; each cold start costs about two to four minutes."""

STARTUP_TIMEOUT_SECONDS = 15 * 60
"""Weights download into the cache volume on the first start; later starts load from it."""

LORA_RANKS = (8, 16, 32, 64, 128, 256, 320, 512)
"""Values vLLM accepts for `--max-lora-rank`."""

GPU = os.environ.get("MODELSTILL_SERVE_GPU", DEFAULT_GPU)
ADAPTERS = os.environ.get("MODELSTILL_ADAPTERS", "")


def adapter_refs(value: str) -> list[str]:
    refs = [ref.strip() for ref in value.split(",") if ref.strip()]
    if not refs:
        raise ValueError("set MODELSTILL_ADAPTERS to the adapters to serve, e.g. task/version")
    for ref in refs:
        parts = ref.split("/")
        if len(parts) != 2 or any(part in ("", ".", "..") for part in parts):
            raise ValueError(f"{ref!r}: each adapter is task/version under adapters/")
    return refs


REFS = adapter_refs(ADAPTERS)


def served_name(path: Path) -> str:
    return f"{path.parent.name}-{path.name}"


@dataclass(frozen=True)
class Adapter:
    name: str
    path: Path
    base: str
    rank: int
    merged: bool = False


def read_adapters(root: Path, refs: Sequence[str]) -> list[Adapter]:
    adapters: list[Adapter] = []
    for ref in refs:
        path = root / ref
        artifact = json.loads((path / "artifact.json").read_text())
        if artifact.get("kind", "adapter") == "merged":
            adapters.append(Adapter(served_name(path), path, artifact["base"], 0, merged=True))
            continue
        rank = int(json.loads((path / "adapter_config.json").read_text())["r"])
        adapters.append(Adapter(served_name(path), path, artifact["base"], rank))
    if any(adapter.merged for adapter in adapters) and len(adapters) > 1:
        raise ValueError("a merged model is served alone")
    bases = {adapter.base for adapter in adapters}
    if len(bases) != 1:
        raise ValueError(f"adapters served together need one base, got {sorted(bases)}")
    return adapters


def _merged_command(model: Adapter) -> list[str]:
    return [
        "vllm", "serve", str(model.path),
        "--host", "0.0.0.0",
        "--port", str(PORT),
        "--dtype", "bfloat16",
        "--max-model-len", str(MAX_MODEL_LEN),
        "--max-logprobs", str(MAX_LOGPROBS),
        "--default-chat-template-kwargs", json.dumps({"enable_thinking": False}),
        "--served-model-name", model.name,
    ]  # fmt: skip


def vllm_command(adapters: Sequence[Adapter]) -> list[str]:
    if adapters[0].merged:
        return _merged_command(adapters[0])
    base = adapters[0].base
    rank = next(value for value in LORA_RANKS if value >= max(a.rank for a in adapters))
    command = [
        "vllm", "serve", base,
        "--host", "0.0.0.0",
        "--port", str(PORT),
        "--dtype", "bfloat16",
        "--max-model-len", str(MAX_MODEL_LEN),
        "--enable-lora",
        "--max-lora-rank", str(rank),
        "--max-loras", str(len(adapters)),
        "--max-logprobs", str(MAX_LOGPROBS),
        "--default-chat-template-kwargs", json.dumps({"enable_thinking": False}),
    ]  # fmt: skip
    for adapter in adapters:
        module = {"name": adapter.name, "path": str(adapter.path), "base_model_name": base}
        command += ["--lora-modules", json.dumps(module)]
    return command


image = (
    modal.Image.debian_slim(python_version=PYTHON_VERSION)
    .uv_pip_install(f"vllm=={VLLM_VERSION}", f"transformers=={TRANSFORMERS_VERSION}")
    .env(
        {
            "HF_HOME": HF_CACHE_MOUNT,
            "MODELSTILL_ADAPTERS": ADAPTERS,
            "MODELSTILL_SERVE_GPU": GPU,
        }
    )
)
artifacts = modal.Volume.from_name(VOLUME_NAME)
hf_cache = modal.Volume.from_name(HF_CACHE_VOLUME_NAME, create_if_missing=True)
app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=GPU,
    volumes={ARTIFACTS_MOUNT: artifacts, HF_CACHE_MOUNT: hf_cache},
    secrets=[modal.Secret.from_name(SECRET_NAME)],
    cpu=CPU_CORES,
    memory=MEMORY_GIB * 1024,
    min_containers=0,
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_SECONDS,
    timeout=10 * 60,
)
@modal.concurrent(max_inputs=MAX_CONCURRENT_REQUESTS)
@modal.web_server(port=PORT, startup_timeout=STARTUP_TIMEOUT_SECONDS)
def serve() -> None:
    if not os.environ.get("VLLM_API_KEY"):
        raise RuntimeError(f"the secret {SECRET_NAME} must set VLLM_API_KEY; refusing to serve")
    adapters = read_adapters(Path(ARTIFACTS_MOUNT) / "adapters", REFS)
    subprocess.Popen(vllm_command(adapters))
