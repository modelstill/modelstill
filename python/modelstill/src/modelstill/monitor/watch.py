import hashlib
import json
import logging
import os
import random
import re
import tempfile
import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import fmean
from typing import Any

from modelstill.benchmark import result_from_json, result_to_json
from modelstill.client import ChatError, ChatReply
from modelstill.evals import Case, compare
from modelstill.monitor.alerts import Alert, AlertSink, Level
from modelstill.monitor.canary import (
    MonitorConfig,
    WatchSettings,
    append_jsonl,
    load_cases,
    resolve,
    score_canary,
    send_alerts,
)
from modelstill.serve.backends import Chat
from modelstill.serve.config import write_mode
from modelstill.serve.events import clickhouse_time
from modelstill.sinks import Row, TableStore
from modelstill.stats import bootstrap_interval, mcnemar_exact, sign_flip_p

_log = logging.getLogger(__name__)

WATCH_RUNS = "modelstill.watch_runs"

Token = dict[str, Any]
Sample = dict[str, Any]

_RANK: dict[str, int] = {"ok": 0, "info": 1, "warn": 2, "critical": 3}


@dataclass(frozen=True)
class WatchBaseline:
    path: Path
    run_id: str
    summary: Row


@dataclass(frozen=True)
class WatchOutcome:
    run_id: str
    level: str
    alerts: tuple[Alert, ...]
    failed: list[str]
    fallback: bool
    prompts: dict[str, dict[str, Any]]
    summary: Row


def _settings(config: MonitorConfig) -> WatchSettings:
    if config.watch is None:
        raise ValueError("the config has no watch section")
    return config.watch


def baseline_path(config: MonitorConfig) -> Path:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{config.task}.{config.provider_label}")
    return config.state_dir / f"watch-baseline.{slug}.json"


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(handle, "w") as stream:
        json.dump(data, stream, default=str)
    Path(temporary).replace(path)


def _tokens(reply: ChatReply) -> list[Token]:
    choices = reply.raw.get("choices") or [{}]
    content = (choices[0].get("logprobs") or {}).get("content") or []
    tokens: list[Token] = []
    for item in content:
        chosen, logprob = str(item["token"]), float(item["logprob"])
        top = {str(alt["token"]): float(alt["logprob"]) for alt in item.get("top_logprobs") or []}
        top.setdefault(chosen, logprob)
        tokens.append({"token": chosen, "logprob": logprob, "top": top})
    return tokens


def token_distance(before: Sequence[Token], after: Sequence[Token]) -> float | None:
    gaps: list[float] = []
    for left, right in zip(before, after, strict=False):
        shared = left["top"].keys() & right["top"].keys()
        gaps.extend(abs(left["top"][token] - right["top"][token]) for token in shared)
        if left["token"] != right["token"]:
            break
    return fmean(gaps) if gaps else None


def _prompt_params(config: MonitorConfig, settings: WatchSettings) -> dict[str, Any]:
    params: dict[str, Any] = {
        **config.params,
        "temperature": 0,
        "max_tokens": settings.max_tokens,
    }
    if settings.logprobs:
        params["logprobs"] = True
        if settings.top_logprobs:
            params["top_logprobs"] = settings.top_logprobs
    return params


def _sampler(config: MonitorConfig, chat: Chat) -> Callable[[Case], Sample | None]:
    settings = _settings(config)
    build = resolve(config.request, "request")
    params = _prompt_params(config, settings)

    def sample(case: Case) -> Sample | None:
        try:
            reply = chat.chat(config.model, build(case.input), **params)
        except (ChatError, OSError) as error:
            _log.warning("watch prompt %s failed: %s", case.id, error)
            return None
        return {
            "hash": hashlib.sha256(reply.text.encode()).hexdigest(),
            "model": reply.model,
            "tokens": _tokens(reply),
        }

    return sample


def record_baseline(
    config: MonitorConfig,
    chat: Chat,
    clock: Callable[[], datetime],
    replace: bool = False,
) -> WatchBaseline:
    settings = _settings(config)
    path = baseline_path(config)
    if path.exists() and not replace:
        raise FileExistsError(f"{path} holds a baseline already; pass --replace to record anew")
    version, cases = load_cases(settings.prompts, settings.limit)
    sample = _sampler(config, chat)
    canary: dict[str, Any] | None = None
    if config.canary is not None:
        canary_version, _, result = score_canary(config, config.canary, chat)
        canary = {"version": canary_version, "result": result_to_json(result)}
    prompts: dict[str, list[Sample]] = {}
    failed: list[str] = []
    for case in cases:
        samples = [sample(case) for _ in range(settings.repeats)]
        complete = [item for item in samples if item is not None]
        if len(complete) == settings.repeats:
            prompts[case.id] = complete
        else:
            failed.append(case.id)
    run_id, ts = uuid.uuid4().hex, clock()
    _write_json(
        path,
        {
            "run_id": run_id,
            "ts": ts.isoformat(),
            "task": config.task,
            "provider": config.provider_label,
            "prompts_version": version,
            "canary": canary,
            "prompts": prompts,
            "failed": failed,
        },
    )
    passed = None if canary is None else sum(s["score"] for s in canary["result"]["scores"])
    summary: Row = {
        "run_id": run_id,
        "ts": ts.isoformat(),
        "task": config.task,
        "provider": config.provider_label,
        "baseline": str(path),
        "prompts": len(prompts),
        "with_logprobs": sum(1 for samples in prompts.values() if samples[0]["tokens"]),
        "failed": failed,
        "canary_passed": None if passed is None else int(passed),
        "canary_items": None if canary is None else len(canary["result"]["scores"]),
        "canary_low": None if canary is None else canary["result"]["low"],
        "canary_high": None if canary is None else canary["result"]["high"],
    }
    return WatchBaseline(path=path, run_id=run_id, summary=summary)


def _check_canary(
    config: MonitorConfig, chat: Chat, recorded: dict[str, Any] | None, alpha: float
) -> tuple[Row, list[Alert]]:
    fields: Row = {
        "canary_items": None,
        "canary_passed": None,
        "canary_baseline_passed": None,
        "canary_pass_rate": None,
        "canary_low": None,
        "canary_high": None,
        "canary_floor": None,
        "canary_difference": None,
        "canary_difference_low": None,
        "canary_difference_high": None,
        "canary_mcnemar_p": None,
    }
    if config.canary is None or recorded is None:
        return fields, []
    version, _, after = score_canary(config, config.canary, chat)
    if version != recorded["version"]:
        raise ValueError("the canary benchmark changed since the baseline; record a new baseline")
    before = result_from_json(recorded["result"])
    comparison = compare(before, after)
    p = mcnemar_exact(comparison.broken, comparison.fixed)
    floor = config.canary.floor
    passed = sum(1 for score in after.scores if score.score == 1.0)
    fields.update(
        {
            "canary_items": len(after.scores),
            "canary_passed": passed,
            "canary_baseline_passed": sum(1 for score in before.scores if score.score == 1.0),
            "canary_pass_rate": after.mean,
            "canary_low": after.low,
            "canary_high": after.high,
            "canary_floor": floor,
            "canary_difference": comparison.difference,
            "canary_difference_low": comparison.low,
            "canary_difference_high": comparison.high,
            "canary_mcnemar_p": p,
        }
    )
    provider, task = config.provider_label, config.task
    summary = f"pass rate {after.mean:.2f} [{after.low:.2f}, {after.high:.2f}]"
    fired: list[Alert] = []
    if after.high < floor:
        fired.append(
            Alert(
                "watch_canary_below_floor",
                task,
                f"{provider}: {summary} is below the floor {floor:.2f}",
                {"provider": provider, "low": after.low, "high": after.high, "floor": floor},
                level="critical",
            )
        )
    if p < alpha and comparison.broken > comparison.fixed:
        fired.append(
            Alert(
                "watch_canary_regression",
                task,
                f"{provider}: {summary} against {before.mean:.2f} at baseline; "
                f"{comparison.broken} items broke, {comparison.fixed} fixed, "
                f"exact McNemar p={p:.4f}",
                {"provider": provider, "broken": comparison.broken, "fixed": comparison.fixed},
                level="critical",
            )
        )
    return fields, fired


def _compare_prompts(
    cases: Sequence[Case],
    reference: dict[str, list[Sample]],
    sample: Callable[[Case], Sample | None],
) -> tuple[dict[str, dict[str, Any]], list[str], Counter[str]]:
    details: dict[str, dict[str, Any]] = {}
    failed: list[str] = []
    models: Counter[str] = Counter()
    for case in cases:
        recorded = reference.get(case.id)
        if recorded is None:
            continue
        current = sample(case)
        if current is None:
            failed.append(case.id)
            continue
        known = {item["hash"] for item in recorded}
        models[current["model"]] += 1
        details[case.id] = {
            "changed": current["hash"] not in known,
            "stable": len(known) == 1,
            "model": current["model"],
            "shift": token_distance(recorded[0]["tokens"], current["tokens"]),
            "noise": token_distance(recorded[0]["tokens"], recorded[1]["tokens"]),
        }
    return details, failed, models


def _logprob_stats(details: dict[str, dict[str, Any]], settings: WatchSettings) -> Row:
    pairs = [
        (item["shift"], item["noise"])
        for item in details.values()
        if item["shift"] is not None and item["noise"] is not None
    ]
    if not pairs:
        empty = ("shift", "noise", "excess", "excess_low", "excess_high", "p")
        return {"logprob_prompts": 0, **{f"logprob_{name}": None for name in empty}}
    excess = [shift - noise for shift, noise in pairs]
    low, high = bootstrap_interval(excess, random.Random(0), 2000)
    return {
        "logprob_prompts": len(pairs),
        "logprob_shift": fmean(shift for shift, _ in pairs),
        "logprob_noise": fmean(noise for _, noise in pairs),
        "logprob_excess": fmean(excess),
        "logprob_excess_low": low,
        "logprob_excess_high": high,
        "logprob_p": sign_flip_p(excess, rounds=settings.rounds),
    }


def _prompt_alerts(
    config: MonitorConfig,
    details: dict[str, dict[str, Any]],
    models: Counter[str],
    baseline_models: set[str],
    logprobs: Row,
) -> list[Alert]:
    settings = _settings(config)
    provider, task = config.provider_label, config.task
    fired: list[Alert] = []
    p = logprobs["logprob_p"]
    if p is not None and p < settings.alpha:
        excess = logprobs["logprob_excess"]
        level: Level = "critical" if excess >= settings.critical_shift else "warn"
        fired.append(
            Alert(
                "watch_logprob_shift",
                task,
                f"{provider}: token log-probs moved {excess:.3f} nats beyond the baseline's own "
                f"noise [{logprobs['logprob_excess_low']:.3f}, "
                f"{logprobs['logprob_excess_high']:.3f}] on {logprobs['logprob_prompts']} "
                f"prompts, sign-flip p={p:.4f}",
                {"provider": provider, **logprobs},
                level=level,
            )
        )
    changed = sorted(key for key, item in details.items() if item["changed"])
    stable_changed = [key for key in changed if details[key]["stable"]]
    if changed:
        share = len(stable_changed) / len(details)
        fired.append(
            Alert(
                "watch_answers_changed",
                task,
                f"{provider}: {len(changed)} of {len(details)} fixed prompts got an answer not "
                f"seen at baseline, {len(stable_changed)} of them on prompts that were stable",
                {"provider": provider, "changed": changed[:20], "share": share},
                level="warn" if share > settings.max_changed else "info",
            )
        )
    new_models = {model for model in models if model not in baseline_models}
    if new_models:
        fired.append(
            Alert(
                "watch_served_model_changed",
                task,
                f"{provider}: the endpoint now reports {sorted(new_models)}, "
                f"baseline {sorted(baseline_models)}",
                {"provider": provider, "models": dict(models)},
                level="warn",
            )
        )
    return fired


def _level(alerts: Sequence[Alert]) -> str:
    return max((alert.level for alert in alerts), key=_RANK.__getitem__, default="ok")


def check_watch(
    config: MonitorConfig,
    chat: Chat,
    stores: Sequence[TableStore],
    alerts: Sequence[AlertSink],
    clock: Callable[[], datetime],
    fallback: Path | None = None,
) -> WatchOutcome:
    settings = _settings(config)
    path = baseline_path(config)
    if not path.exists():
        raise FileNotFoundError(f"no baseline at {path}: run modelstill watch baseline first")
    baseline = json.loads(path.read_text())
    version, cases = load_cases(settings.prompts, settings.limit)
    if version != baseline["prompts_version"]:
        raise ValueError("the prompt set changed since the baseline; record a new baseline")
    canary, fired = _check_canary(config, chat, baseline["canary"], settings.alpha)
    reference: dict[str, list[Sample]] = baseline["prompts"]
    details, failed, models = _compare_prompts(cases, reference, _sampler(config, chat))
    baseline_models = {item["model"] for samples in reference.values() for item in samples}
    logprobs = _logprob_stats(details, settings)
    fired.extend(_prompt_alerts(config, details, models, baseline_models, logprobs))
    level = _level(fired)
    switched = level == "critical" and fallback is not None
    if fallback is not None and switched:
        write_mode(fallback, "off")
        fired.append(
            Alert(
                "watch_fallback",
                config.task,
                f"{config.provider_label}: set {fallback} to mode off after a critical alert",
                {"deployment": str(fallback)},
                level="critical",
            )
        )
    send_alerts(fired, alerts)
    run_id, ts = uuid.uuid4().hex, clock()
    summary: Row = {
        "ts": clickhouse_time(ts),
        "run_id": run_id,
        "task": config.task,
        "provider": config.provider_label,
        "baseline_run_id": baseline["run_id"],
        "baseline_ts": clickhouse_time(datetime.fromisoformat(baseline["ts"])),
        **canary,
        "prompts": len(details),
        "failed": len(failed),
        "answers_changed": sum(1 for item in details.values() if item["changed"]),
        "stable_changed": sum(1 for item in details.values() if item["changed"] and item["stable"]),
        "served_models": sorted(models),
        **logprobs,
        "alpha": settings.alpha,
        "critical_shift": settings.critical_shift,
        "max_changed": settings.max_changed,
        "level": level,
        "alerts": [alert.kind for alert in fired],
        "fallback": switched,
    }
    append_jsonl(
        config.state_dir / "watch-checks.jsonl",
        {"run_id": run_id, "ts": ts.isoformat(), "summary": summary, "prompts": details},
    )
    for store in stores:
        store.write(WATCH_RUNS, [summary])
    return WatchOutcome(
        run_id=run_id,
        level=level,
        alerts=tuple(fired),
        failed=failed,
        fallback=switched,
        prompts=details,
        summary=summary,
    )
