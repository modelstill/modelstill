# pyright: reportMissingImports=false
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Literal

from modelstill.remote import RemoteHost, Run
from modelstill.train import load_artifact, staged_output

__all__ = ["FORMATS", "RemoteExporter", "export_peft", "main"]

FORMATS = ("peft", "merged", "gguf")
OUTTYPES = ("f16", "bf16", "q8_0")
Remote = Literal["merged", "gguf"]


def export_peft(source: Path, out: Path) -> Path:
    if load_artifact(source).kind != "adapter":
        raise ValueError(f"{source} is not a LoRA adapter, so it has no PEFT form")
    if out.exists():
        raise FileExistsError(f"{out} already exists; exports are never overwritten")
    shutil.copytree(source, out)
    return out


class RemoteExporter:
    def __init__(
        self,
        host: str,
        gpu: str = "0",
        llama_cpp: str = "~/Projects/llama.cpp",
        workdir: str = "modelstill",
        poll_seconds: float = 30,
        run: Run = subprocess.run,
        sleep: Callable[[float], None] = time.sleep,
        package_dir: Path | None = None,
    ) -> None:
        self.gpu = gpu
        self.llama_cpp = llama_cpp
        self.remote = RemoteHost(host, workdir, poll_seconds, run, sleep, package_dir)

    def export(self, source: Path, to: Remote, out: Path, outtype: str = "q8_0") -> Path:
        if out.exists():
            raise FileExistsError(f"{out} already exists; exports are never overwritten")
        load_artifact(source)
        workspace = self.remote.prepare()
        remote_in = f"{workspace.root}/exports/in/{source.name}"
        remote_out = f"{workspace.root}/exports/out/{source.name}-{to}-{uuid.uuid4().hex[:6]}"
        self.remote.send_dir(source, remote_in)
        workspace = self.remote.install(workspace)
        prefix = f"{workspace.root}/runs/export-{source.name}-{uuid.uuid4().hex[:8]}"
        result = self.remote.run_job(
            workspace,
            unit=f"modelstill-export-{uuid.uuid4().hex[:8]}",
            prefix=prefix,
            module="modelstill.export",
            args=[to, remote_in, remote_out, "--llama-cpp", self.llama_cpp, "--outtype", outtype],
            gpus=[self.gpu],
        )
        self.remote.fetch_dir(json.loads(result)["path"], out)
        return out


def _merge(source: Path, final: Path) -> None:
    import torch  # noqa: PLC0415
    from peft import PeftModel  # noqa: PLC0415
    from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: PLC0415

    artifact = load_artifact(source)
    if artifact.kind != "adapter":
        raise ValueError(f"{source} is already merged")
    with staged_output(final) as staging:
        base = AutoModelForCausalLM.from_pretrained(artifact.base, dtype=torch.float32)
        merged = PeftModel.from_pretrained(base, source).merge_and_unload()
        merged.to(torch.bfloat16).save_pretrained(staging)
        AutoTokenizer.from_pretrained(source).save_pretrained(staging)
        artifact.model_copy(update={"path": final, "dtype": "bfloat16", "kind": "merged"}).write(
            staging
        )


def _gguf(source: Path, final: Path, llama_cpp: Path, outtype: str) -> None:
    with tempfile.TemporaryDirectory() as scratch, staged_output(final) as staging:
        merged = Path(scratch) / "merged"
        _merge(source, merged)
        env = {**os.environ, "PYTHONPATH": str(llama_cpp / "gguf-py")}
        subprocess.run(
            [
                sys.executable,
                str(llama_cpp / "convert_hf_to_gguf.py"),
                str(merged),
                "--outfile",
                str(staging / f"{source.name}-{outtype}.gguf"),
                "--outtype",
                outtype,
            ],
            check=True,
            env=env,
        )
        shutil.copy(source / "artifact.json", staging / "artifact.json")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m modelstill.export")
    parser.add_argument("to", choices=("merged", "gguf"))
    parser.add_argument("source", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("result", type=Path)
    parser.add_argument("--llama-cpp", type=Path, default=Path("~/Projects/llama.cpp"))
    parser.add_argument("--outtype", choices=OUTTYPES, default="q8_0")
    args = parser.parse_args(argv)
    if args.to == "merged":
        _merge(args.source, args.out)
    else:
        _gguf(args.source, args.out, args.llama_cpp.expanduser(), args.outtype)
    args.result.write_text(json.dumps({"path": str(args.out)}))


if __name__ == "__main__":
    main()
