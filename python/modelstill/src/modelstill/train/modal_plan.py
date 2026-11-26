import hashlib
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path, PurePosixPath

from modelstill.train import Message, TextPart, TrainingPlan, file_sha256, read_chat_jsonl

VOLUME_NAME = "modelstill-artifacts"
HF_CACHE_VOLUME_NAME = "modelstill-hf-cache"
ARTIFACTS_MOUNT = "/artifacts"
HF_CACHE_MOUNT = "/hf-cache"
APP_NAME = "modelstill-train"
PYTHON_VERSION = "3.12"
DEFAULT_GPU = "L40S"
CPU_CORES = 2.0
MEMORY_GIB = 16
MAX_TIMEOUT_MINUTES = 24 * 60
MIN_TIMEOUT_MINUTES = 30

GPU_PRICES_PER_HOUR: dict[str, float] = {
    "T4": 0.590,
    "L4": 0.799,
    "A10G": 1.102,
    "L40S": 1.951,
    "A100-40GB": 2.099,
    "A100-80GB": 2.498,
    "H100": 3.949,
    "H200": 4.540,
    "B200": 6.250,
}
"""Modal on-demand GPU prices in US$ per hour: the per-second prices on https://modal.com/pricing
(read 2026-11-23; T4 0.000164, L4 0.000222, A10 0.000306, L40S 0.000542, A100 40 GB 0.000583,
A100 80 GB 0.000694, H100 0.001097, H200 0.001261, B200 0.001736 per second) times 3,600. Modal's
"A10" is requested as `A10G`."""

CPU_CORE_PER_HOUR = 0.0472
"""US$ per physical core-hour $0.0000131 per core-second (modal.com/pricing, 2026-11-23)."""

MEMORY_GIB_PER_HOUR = 0.0080
"""US$ per GiB-hour of memory: $0.00000222 per GiB-second (modal.com/pricing, 2026-11-23)."""

GPU_BF16_TFLOPS: dict[str, float] = {
    "T4": 65.0,
    "L4": 121.0,
    "A10G": 125.0,
    "L40S": 362.0,
    "A100-40GB": 312.0,
    "A100-80GB": 312.0,
    "H100": 989.0,
    "H200": 989.0,
    "B200": 2250.0,
}
"""Dense (non-sparse) BF16 tensor TFLOPS from NVIDIA datasheets (T4 is FP16: it has no BF16).
The A10 datasheet figure is used for A10G, which flatters the A10G if anything."""

UTILIZATION = 0.25
"""Assumed share of peak FLOPS a TRL LoRA run reaches (padding, eval, data loading, small
matrices). Replace it with the measured rate (`train_runtime_s` in the artifact) after the
first run."""

FLOPS_PER_PARAM_TOKEN = 8.0
"""Training FLOPs per base parameter per token: 2 forward, 2 for activation gradients, 2 for the
forward recomputed by gradient checkpointing, and about 2 for attention at 2k-4k tokens. LoRA
skips the base weight gradients, the term full fine-tuning adds."""

EVAL_FLOPS_PER_PARAM_TOKEN = 2.0
"""Evaluation is one forward pass."""

CHARS_PER_TOKEN = 3.5
"""Characters per Qwen3 token for English and JSON; erring low counts more tokens."""

TEMPLATE_TOKENS_PER_MESSAGE = 8
"""Chat template tokens around each message (role markers, the empty think block)."""

STARTUP_HOURS = 0.2
"""Container start, base model download into the cache volume, model load and tokenization."""

TIMEOUT_MARGIN = 2.0
"""Default timeout is this multiple of the estimate, so a slower GPU than assumed still
finishes while a hung run is stopped."""

ASSUMPTIONS = {
    "utilization": UTILIZATION,
    "flops_per_param_token": FLOPS_PER_PARAM_TOKEN,
    "chars_per_token": CHARS_PER_TOKEN,
    "startup_hours": STARTUP_HOURS,
    "prices": "modal.com/pricing, read 2026-11-23",
}


def image_requirements() -> list[str]:
    requirements: list[str] = []
    for requirement in metadata.requires("modelstill") or []:
        spec, _, marker = requirement.partition(";")
        marker = marker.strip()
        if not marker or re.fullmatch(r"""extra\s*==\s*["']train["']""", marker):
            requirements.append(spec.strip())
    return requirements


def params_billions(base: str) -> float:
    match = re.search(r"(\d+(?:\.\d+)?)B(?![a-z])", base.rsplit("/", 1)[-1])
    if match is None:
        raise ValueError(
            f"cannot read the parameter count from {base!r} (expected e.g. Qwen3-1.7B)"
        )
    return float(match.group(1))


def expected_padded_length(lengths: Sequence[int], batch: int) -> float:
    ordered = sorted(lengths)
    count = len(ordered)
    return sum(
        length * ((rank / count) ** batch - ((rank - 1) / count) ** batch)
        for rank, length in enumerate(ordered, start=1)
    )


IMAGE_TOKENS = 1024


def _cost(message: Message) -> tuple[int, int]:
    if isinstance(message.content, str):
        return len(message.content), 0
    text = sum(len(part.text) for part in message.content if isinstance(part, TextPart))
    return text, sum(1 for part in message.content if not isinstance(part, TextPart))


def row_lengths(path: Path, max_seq_length: int) -> list[int]:
    lengths: list[int] = []
    for row in read_chat_jsonl(path):
        costs = [_cost(message) for message in row.messages]
        characters = sum(chars for chars, _ in costs)
        tokens = math.ceil(characters / CHARS_PER_TOKEN) + IMAGE_TOKENS * sum(n for _, n in costs)
        tokens += TEMPLATE_TOKENS_PER_MESSAGE * len(row.messages)
        lengths.append(min(tokens, max_seq_length))
    return lengths


@dataclass(frozen=True)
class Estimate:
    gpu: str
    rows: int
    tokens_per_row: float
    steps: int
    evals: int
    hours: float
    cost_usd: float
    timeout_minutes: int
    max_cost_usd: float
    gpu_memory_gib: float = 0.0
    cpu: float = CPU_CORES
    memory_gib: int = MEMORY_GIB

    @property
    def usd_per_hour(self) -> float:
        return hourly_cost(self.gpu, self.cpu, self.memory_gib)


def hourly_cost(gpu: str, cpu: float = CPU_CORES, memory_gib: int = MEMORY_GIB) -> float:
    if gpu not in GPU_PRICES_PER_HOUR:
        raise ValueError(f"unknown GPU {gpu!r}; known: {sorted(GPU_PRICES_PER_HOUR)}")
    return GPU_PRICES_PER_HOUR[gpu] + cpu * CPU_CORE_PER_HOUR + memory_gib * MEMORY_GIB_PER_HOUR


BYTES_PER_PARAM = {"lora": 2.0, "full": 16.0}
ACTIVATION_GIB = 3.0


def gpu_memory_gib(plan: TrainingPlan) -> float:
    per_param = 0.6 if plan.quantization == "4bit" else BYTES_PER_PARAM.get(plan.method, 2.0)
    weights = params_billions(plan.base) * 1e9 * per_param
    if plan.distill is not None:
        weights += params_billions(plan.distill.teacher) * 1e9 * 2.0
    return round(weights / 2**30 + ACTIVATION_GIB, 1)


def estimate(
    plan: TrainingPlan, gpu: str = DEFAULT_GPU, timeout_minutes: int | None = None
) -> Estimate:
    per_hour = hourly_cost(gpu)
    if timeout_minutes is not None and not 0 < timeout_minutes <= MAX_TIMEOUT_MINUTES:
        raise ValueError("Modal functions run at most 24 hours: timeout must be 1-1440 minutes")
    train = row_lengths(plan.train_path, plan.max_seq_length)
    val = row_lengths(plan.val_path, plan.max_seq_length)
    if not train:
        raise ValueError(f"{plan.train_path} has no rows")
    rows_per_step = plan.batch_size * plan.gradient_accumulation
    if plan.max_steps is not None:
        steps = plan.max_steps
    else:
        steps = math.ceil(math.ceil(len(train) / rows_per_step) * plan.epochs)
    evals = steps // plan.eval_steps + 1
    padded = expected_padded_length(train, plan.batch_size)
    val_padded = expected_padded_length(val, plan.batch_size) if val else 0.0
    params = params_billions(plan.base) * 1e9
    flops = FLOPS_PER_PARAM_TOKEN * params * steps * rows_per_step * padded
    flops += EVAL_FLOPS_PER_PARAM_TOKEN * params * evals * len(val) * val_padded
    hours = flops / (GPU_BF16_TFLOPS[gpu] * 1e12 * UTILIZATION) / 3600 + STARTUP_HOURS
    if timeout_minutes is None:
        timeout_minutes = min(
            MAX_TIMEOUT_MINUTES,
            max(MIN_TIMEOUT_MINUTES, math.ceil(hours * 60 * TIMEOUT_MARGIN)),
        )
    return Estimate(
        gpu=gpu,
        rows=len(train),
        tokens_per_row=padded,
        steps=steps,
        evals=evals,
        hours=hours,
        cost_usd=hours * per_hour,
        timeout_minutes=timeout_minutes,
        max_cost_usd=timeout_minutes / 60 * per_hour,
        gpu_memory_gib=gpu_memory_gib(plan),
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@dataclass(frozen=True)
class VolumePlan:
    train_remote: str
    val_remote: str
    plan_remote: str
    plan: TrainingPlan

    def plan_json(self) -> str:
        return self.plan.model_dump_json(indent=2) + "\n"


def volume_plan(plan: TrainingPlan) -> VolumePlan:
    inputs = PurePosixPath("inputs") / plan.task
    train_remote = str(inputs / f"{file_sha256(plan.train_path)}.jsonl")
    val_remote = str(inputs / f"{file_sha256(plan.val_path)}.jsonl")
    mount = Path(ARTIFACTS_MOUNT)
    remote = plan.model_copy(
        update={
            "train_path": mount / train_remote,
            "val_path": mount / val_remote,
            "output_root": mount / "adapters",
        }
    )
    text = remote.model_dump_json(indent=2) + "\n"
    plan_remote = str(PurePosixPath("plans") / plan.task / f"{_sha256(text)}.json")
    return VolumePlan(train_remote, val_remote, plan_remote, remote)


def dry_run(
    plan: TrainingPlan, gpu: str = DEFAULT_GPU, timeout_minutes: int | None = None
) -> dict[str, object]:
    result = estimate(plan, gpu, timeout_minutes)
    layout = volume_plan(plan)
    return {
        "backend": "modal",
        "app": APP_NAME,
        "volume": VOLUME_NAME,
        "uploads": [layout.train_remote, layout.val_remote, layout.plan_remote],
        "plan": layout.plan.model_dump(mode="json"),
        "gpu": gpu,
        "gpu_usd_per_hour": GPU_PRICES_PER_HOUR[gpu],
        "usd_per_hour": round(result.usd_per_hour, 4),
        "cpu": result.cpu,
        "memory_gib": result.memory_gib,
        "timeout_minutes": result.timeout_minutes,
        "rows": result.rows,
        "padded_tokens_per_row": round(result.tokens_per_row, 1),
        "steps": result.steps,
        "evals": result.evals,
        "estimated_hours": round(result.hours, 2),
        "estimated_cost_usd": round(result.cost_usd, 2),
        "max_cost_usd": round(result.max_cost_usd, 2),
        "image": image_requirements(),
        "assumptions": ASSUMPTIONS,
    }
