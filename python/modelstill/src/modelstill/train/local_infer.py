# pyright: reportMissingImports=false

import re
from pathlib import Path
from typing import Any, Self

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from modelstill.train import (
    Generation,
    TrainedArtifact,
    flip_rate,
    load_artifact,
    staged_output,
)
from modelstill.train.trl_backend import device

__all__ = ["LocalModel", "flip_rate", "merge_and_export"]

_THINK = re.compile(r"^\s*<think>.*?</think>\s*", re.DOTALL)
_DTYPES = {"float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}


class LocalModel:
    def __init__(self, model: Any, tokenizer: Any, max_new_tokens: int = 256) -> None:
        self.model = model.eval()
        self.tokenizer = tokenizer
        self.max_new_tokens = max_new_tokens

    @classmethod
    def from_base(cls, base: str, max_new_tokens: int = 256, dtype: str = "float32") -> Self:
        model: Any = AutoModelForCausalLM.from_pretrained(base, dtype=_DTYPES[dtype])
        return cls(model.to(device()), AutoTokenizer.from_pretrained(base), max_new_tokens)

    @classmethod
    def from_artifact(cls, path: Path, max_new_tokens: int = 256) -> Self:
        artifact = load_artifact(path)
        tokenizer = AutoTokenizer.from_pretrained(path)
        dtype = _DTYPES[artifact.dtype]
        model: Any
        if artifact.kind == "merged":
            model = AutoModelForCausalLM.from_pretrained(path, dtype=dtype)
        else:
            base = AutoModelForCausalLM.from_pretrained(artifact.base, dtype=dtype)
            model = PeftModel.from_pretrained(base, path)
        return cls(model.to(device()), tokenizer, max_new_tokens)

    @torch.inference_mode()
    def generate(self, messages: list[dict[str, str]]) -> Generation:
        inputs = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            enable_thinking=False,
            return_tensors="pt",
            return_dict=True,
        ).to(self.model.device)
        output = self.model.generate(
            **inputs,
            max_new_tokens=self.max_new_tokens,
            do_sample=False,
            output_scores=True,
            return_dict_in_generate=True,
            pad_token_id=self.tokenizer.pad_token_id or self.tokenizer.eos_token_id,
        )
        prompt_length = inputs["input_ids"].shape[1]
        generated = output.sequences[0, prompt_length:].tolist()
        scores = self.model.compute_transition_scores(
            output.sequences, output.scores, normalize_logits=True
        )[0].tolist()
        stops = _stop_ids(self.model, self.tokenizer)
        count = next(
            (index + 1 for index, token in enumerate(generated) if token in stops), len(generated)
        )
        text = self.tokenizer.decode(generated[:count], skip_special_tokens=True)
        return Generation(
            text=_THINK.sub("", text).strip(),
            mean_logprob=sum(scores[:count]) / max(count, 1),
            tokens=count,
        )


def _stop_ids(model: Any, tokenizer: Any) -> set[int]:
    configured = model.generation_config.eos_token_id
    ids = set(configured if isinstance(configured, list) else [configured])
    ids.add(tokenizer.eos_token_id)
    return {token for token in ids if token is not None}


def merge_and_export(adapter_path: Path) -> TrainedArtifact:
    artifact = load_artifact(adapter_path)
    if artifact.kind != "adapter":
        raise ValueError(f"{adapter_path} is already a merged export")
    final = adapter_path.parent / f"{adapter_path.name}-merged-fp16"
    with staged_output(final) as staging:
        base = AutoModelForCausalLM.from_pretrained(artifact.base, dtype=torch.float32)
        merged = PeftModel.from_pretrained(base, adapter_path).merge_and_unload()
        merged.to(torch.float16).save_pretrained(staging)
        AutoTokenizer.from_pretrained(adapter_path).save_pretrained(staging)
        exported = artifact.model_copy(update={"path": final, "dtype": "float16", "kind": "merged"})
        exported.write(staging)
    return exported
