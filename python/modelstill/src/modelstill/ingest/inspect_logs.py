import json
import math
import zipfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from statistics import fmean
from typing import Any

from modelstill.ingest.runs import ImportedCase, ImportedRun

SOURCE = "inspect"
LETTERS = {"C": 1.0, "I": 0.0, "P": 0.5, "N": 0.0}
WORDS = {"yes": 1.0, "true": 1.0, "no": 0.0, "false": 0.0}


def value_to_float(value: Any) -> float:
    if isinstance(value, bool | int | float):
        return float(value)
    if isinstance(value, str):
        if value in LETTERS:
            return LETTERS[value]
        if value.lower() in WORDS:
            return WORDS[value.lower()]
        try:
            return float(value)
        except ValueError:
            pass
    raise ValueError(f"cannot read score value {value!r} as a number")


def _number(value: Any) -> float | None:
    try:
        return value_to_float(value)
    except ValueError:
        return None


def _archive(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with zipfile.ZipFile(path) as archive:
        names = list(dict.fromkeys(archive.namelist()))
        header_name = "header.json" if "header.json" in names else "_journal/start.json"
        header = json.loads(archive.read(header_name))
        samples = [
            json.loads(archive.read(name))
            for name in names
            if name.startswith("samples/") and name.endswith(".json")
        ]
    return header, samples


def _read(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if zipfile.is_zipfile(path):
        return _archive(path)
    data = json.loads(path.read_text())
    return data, list(data.get("samples") or [])


def _default_scorer(header: Mapping[str, Any], samples: Sequence[Mapping[str, Any]]) -> str:
    scores = (header.get("results") or {}).get("scores") or []
    if scores:
        return str(scores[0].get("name") or scores[0]["scorer"])
    for sample in samples:
        if sample.get("scores"):
            return next(iter(sample["scores"]))
    raise ValueError("the log has no scores to import")


def _present(value: Any) -> bool:
    return value is not None and not (isinstance(value, float) and math.isnan(value))


def _flat(sample: Mapping[str, Any]) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for name, score in (sample.get("scores") or {}).items():
        value = score.get("value")
        if isinstance(value, Mapping):
            flat.update({f"{name}.{key}": item for key, item in value.items()})
        else:
            flat[name] = value
    return {key: value for key, value in flat.items() if _present(value)}


def _epoch_score(sample: Mapping[str, Any], scorer: str, flat: Mapping[str, Any]) -> float | None:
    if scorer in flat:
        return value_to_float(flat[scorer])
    nested = sorted(key for key in flat if key.startswith(f"{scorer}."))
    if nested:
        raise ValueError(f"scorer {scorer!r} gives several values; pick one: {', '.join(nested)}")
    return 0.0 if sample.get("error") else None


def _case(case_id: str, epochs: Sequence[Mapping[str, Any]], scorer: str) -> ImportedCase | None:
    scores: list[float] = []
    metrics: dict[str, list[float]] = {}
    for sample in epochs:
        flat = _flat(sample)
        score = _epoch_score(sample, scorer, flat)
        if score is not None:
            scores.append(score)
        for key, value in flat.items():
            number = _number(value)
            if key != scorer and number is not None:
                metrics.setdefault(key, []).append(number)
    if not scores:
        return None
    first = epochs[0]
    errors = [sample["error"]["message"] for sample in epochs if sample.get("error")]
    times = [float(sample["total_time"]) for sample in epochs if sample.get("total_time")]
    return ImportedCase(
        id=case_id,
        input=first.get("input"),
        expected=first.get("target"),
        score=fmean(scores),
        output=(first.get("output") or {}).get("completion"),
        error="; ".join(errors) or None,
        metrics={key: fmean(values) for key, values in metrics.items()},
        latency_ms=fmean(times) * 1000 if times else None,
    )


def load(path: Path, model: str | None = None, scorer: str | None = None) -> ImportedRun:
    header, samples = _read(path)
    chosen = scorer or _default_scorer(header, samples)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for sample in sorted(samples, key=lambda found: found.get("epoch", 1)):
        grouped.setdefault(str(sample["id"]), []).append(sample)
    cases = [_case(case_id, epochs, chosen) for case_id, epochs in grouped.items()]
    named = str((header.get("eval") or {}).get("model") or SOURCE)
    return ImportedRun(model or named, SOURCE, tuple(case for case in cases if case is not None))
