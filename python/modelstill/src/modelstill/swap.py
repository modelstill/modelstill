import argparse
import importlib
import json
import math
import os
import random
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, Literal, Protocol

import yaml

from modelstill.benchmark import Benchmark, History, MetricValue
from modelstill.client import ChatClient, ChatReply
from modelstill.data import DatasetItem, DatasetStore
from modelstill.evals import Case, Comparison, RunResult, compare, mean_interval, set_f1
from modelstill.evals import run as score_run
from modelstill.gate import Check
from modelstill.spec import TaskSpec, load_spec
from modelstill.stats import clopper_pearson

Verdict = Literal["switch", "do_not_switch", "inconclusive"]
Messages = list[dict[str, str]]
Render = Callable[[Any], Messages]
Clock = Callable[[], float]
View = Callable[[Sequence[str]], Sequence[str | None]]
Stratify = Callable[[str | None], str]
NoiseSource = Literal["provided", "repeats", "not_measured"]
DEFAULT_MARGIN = 0.02
RECORDED = "production"
RECORDED_MODE = "recorded"
REPEAT_SUFFIX = "_repeat"


class Chat(Protocol):
    def chat(self, model: str, messages: Messages, **params: Any) -> ChatReply: ...


class UnreadableAnswer(Exception):
    pass


@dataclass(frozen=True)
class Endpoint:
    model: str
    base_url: str
    label: str


def parse_endpoint(text: str, default_url: str) -> Endpoint:
    model, _, url = text.partition("@")
    if not model:
        raise ValueError(f"endpoint {text!r} names no model")
    return Endpoint(model, url or default_url, text if url else model)


@dataclass(frozen=True)
class Agreement:
    name: str
    score: Callable[[str, str], float]
    readable: Callable[[str], bool]


def _parse(text: str) -> Any:
    return json.loads(text)


def _is_json(text: str) -> bool:
    try:
        _parse(text)
    except ValueError:
        return False
    return True


def _items(value: Any) -> list[Any]:
    if isinstance(value, dict):
        lists = [entry for entry in value.values() if isinstance(entry, list)]
        value = lists[0] if len(lists) == 1 else [value]
    if not isinstance(value, list):
        value = [value]
    return [json.dumps(entry, sort_keys=True) for entry in value]


def _set_agreement(output: str, reference: str) -> float:
    return set_f1(_items(_parse(output)), _items(_parse(reference)))


def _json_agreement(output: str, reference: str) -> float:
    return 1.0 if _parse(output) == _parse(reference) else 0.0


def _exact_agreement(output: str, reference: str) -> float:
    return 1.0 if output.strip() == reference.strip() else 0.0


def _not_blank(text: str) -> bool:
    return bool(text.strip())


BUILT_IN = {
    "set_f1": Agreement("set_f1", _set_agreement, _is_json),
    "json": Agreement("json", _json_agreement, _is_json),
    "exact": Agreement("exact", _exact_agreement, _not_blank),
}


def _attribute(path: str) -> Any:
    module, _, attribute = path.partition(":")
    if not attribute:
        raise ValueError(f"{path!r} is not a built-in name or module:attr")
    return getattr(importlib.import_module(module), attribute)


def agreement(name: str) -> Agreement:
    if name in BUILT_IN:
        return BUILT_IN[name]
    return Agreement(name, _attribute(name), _not_blank)


def agreement_for(spec: TaskSpec, name: str | None) -> Agreement:
    if name is not None:
        return agreement(name)
    metric = next(item for item in spec.requirements if item.id == spec.eval.gate.metric)
    return BUILT_IN["set_f1" if metric.type == "set_f1" else "json"]


def render_with_system(system: str) -> Render:
    def render(value: Any) -> Messages:
        if isinstance(value, dict) and isinstance(value.get("messages"), list):
            return list(value["messages"])
        content = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        return [{"role": "system", "content": system}, {"role": "user", "content": content}]

    return render


def render_for(spec_path: Path, prompt: str | None) -> Render:
    system = (spec_path.parent / load_spec(spec_path).instruction).read_text()
    if prompt is None:
        return render_with_system(system)
    build = _attribute(prompt)
    return lambda value: build(system, value)


@dataclass(frozen=True)
class Price:
    input_cost_per_token: float
    output_cost_per_token: float


def _price(info: Mapping[str, Any]) -> Price:
    return Price(
        float(info.get("input_cost_per_token", 0.0)),
        float(info.get("output_cost_per_token", 0.0)),
    )


def prices_from_config(config: Mapping[str, Any]) -> dict[str, Price]:
    return {
        entry["model_name"]: _price(entry["model_info"])
        for entry in config.get("model_list", [])
        if entry.get("model_info")
    }


def load_prices(path: Path) -> dict[str, Price]:
    data = yaml.safe_load(path.read_text()) or {}
    if "model_list" in data:
        return prices_from_config(data)
    return {name: _price(info) for name, info in data.items()}


def sample_items(found: Sequence[DatasetItem], size: int | None, seed: int) -> list[DatasetItem]:
    if size is None or size >= len(found):
        return list(found)
    chosen = set(random.Random(seed).sample(range(len(found)), size))
    return [item for index, item in enumerate(found) if index in chosen]


@dataclass(frozen=True)
class Answer:
    text: str | None
    error: str | None
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    model: str | None = None


@dataclass(frozen=True)
class Interval:
    value: float
    low: float
    high: float


@dataclass(frozen=True)
class Usage:
    calls: int
    unreadable: int
    unreadable_rate: Interval
    cost_per_1k_calls: float | None
    p50_latency_ms: int | None
    p95_latency_ms: int | None
    answered_by: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class Current:
    endpoint: str
    model: str
    base_url: str
    usage: Usage
    self_agreement: Interval
    agreement_with_recorded: Interval | None
    run_id: str | None


@dataclass(frozen=True)
class Gap:
    difference: float
    low: float
    high: float
    fixed: int | None
    broken: int | None


@dataclass(frozen=True)
class Stratum:
    name: str
    cases: int
    agreement: Interval


@dataclass(frozen=True)
class RecordedCurrent:
    endpoint: str
    teacher: str
    cases: int
    skipped: int
    unreadable: int
    noise_floor: Interval | None
    noise_source: NoiseSource
    noise_cases: int
    run_id: str | None


@dataclass(frozen=True)
class Candidate:
    endpoint: str
    model: str
    base_url: str
    usage: Usage
    agreement: Interval
    agreement_with_recorded: Interval | None
    gap: Gap | None
    cost_ratio: float | None
    checks: tuple[Check, ...]
    verdict: Verdict
    run_id: str | None
    strata: tuple[Stratum, ...] = ()


@dataclass(frozen=True)
class Report:
    task: str
    metric: str
    margin: float
    cases: int
    repeats: int
    current: Current | RecordedCurrent
    candidates: tuple[Candidate, ...]
    decision: Verdict
    choice: str | None
    litellm: dict[str, Any] | None

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _ask(
    chat: Chat, model: str, messages: Messages, params: Mapping[str, Any], clock: Clock
) -> Answer:
    started = clock()
    try:
        reply = chat.chat(model, messages, **params)
    except Exception as error:  # noqa: BLE001
        return Answer(None, f"{type(error).__name__}: {error}", (clock() - started) * 1000, 0, 0)
    return Answer(
        reply.text,
        None,
        (clock() - started) * 1000,
        reply.prompt_tokens,
        reply.completion_tokens,
        reply.model,
    )


def replay(
    chat: Chat,
    endpoint: Endpoint,
    requests: Sequence[Messages],
    params: Mapping[str, Any],
    clock: Clock,
    workers: int,
) -> list[Answer]:
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(
            pool.map(lambda messages: _ask(chat, endpoint.model, messages, params, clock), requests)
        )


def _readable(answer: Answer, metric: Agreement) -> bool:
    return answer.text is not None and metric.readable(answer.text)


def _scored(
    cases: Sequence[Case],
    outputs: Sequence[Answer],
    references: Sequence[str | None],
    metric: Agreement,
) -> RunResult:
    by_id = {
        case.id: (output, reference)
        for case, output, reference in zip(cases, outputs, references, strict=True)
    }

    def answer(case_id: str) -> str:
        output, _ = by_id[case_id]
        if output.text is None:
            raise UnreadableAnswer(output.error or "no answer")
        if not metric.readable(output.text):
            raise UnreadableAnswer(output.text[:200])
        return output.text

    def score(output: str, reference: str | None) -> float:
        if reference is None or not metric.readable(reference):
            return 0.0
        return float(metric.score(output, reference))

    keyed = [
        Case(case.id, case.id, reference) for case, reference in zip(cases, references, strict=True)
    ]
    return score_run(keyed, answer, score)


def _texts(answers: Sequence[Answer]) -> list[str | None]:
    return [answer.text for answer in answers]


def _mean_of(results: Sequence[RunResult], cases: Sequence[Case]) -> RunResult:
    if len(results) == 1:
        return results[0]
    values = [
        sum(result.scores[index].score for result in results) / len(results)
        for index in range(len(cases))
    ]
    lookup = dict(zip((case.id for case in cases), values, strict=True))
    return score_run(
        [Case(case.id, case.id, None) for case in cases],
        lambda case_id: lookup[case_id],
        lambda output, _: output,
    )


def _interval(result: RunResult) -> Interval:
    return Interval(result.mean, result.low, result.high)


def _percentile(values: Sequence[float], share: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(share * len(ordered)) - 1)])


def _usage(answers: Sequence[Answer], metric: Agreement, price: Price | None) -> Usage:
    unreadable = sum(1 for answer in answers if not _readable(answer, metric))
    low, high = clopper_pearson(unreadable, len(answers))
    answered = [answer for answer in answers if answer.error is None]
    cost = None
    if price is not None and answered:
        spent = sum(
            answer.prompt_tokens * price.input_cost_per_token
            + answer.completion_tokens * price.output_cost_per_token
            for answer in answered
        )
        cost = 1000 * spent / len(answered)
    latencies = [answer.latency_ms for answer in answered]
    return Usage(
        calls=len(answers),
        unreadable=unreadable,
        unreadable_rate=Interval(unreadable / len(answers), low, high),
        cost_per_1k_calls=cost,
        p50_latency_ms=_percentile(latencies, 0.5),
        p95_latency_ms=_percentile(latencies, 0.95),
        answered_by=dict(Counter(answer.model for answer in answered if answer.model)),
    )


def _price_of(prices: Mapping[str, Price], endpoint: Endpoint) -> Price | None:
    return prices.get(endpoint.label) or prices.get(endpoint.model)


def _checks(
    gap: Comparison | Gap,
    margin: float,
    cost_ratio: float | None,
    p95: int | None,
    max_cost_ratio: float | None,
    max_p95_latency_ms: int | None,
) -> tuple[Check, ...]:
    floor = -margin
    return (
        Check("agreement_gap_lower_bound", floor, gap.low, gap.low >= floor),
        Check("agreement_gap_upper_bound", floor, gap.high, gap.high >= floor),
        *_limits(cost_ratio, p95, max_cost_ratio, max_p95_latency_ms),
    )


def _limits(
    cost_ratio: float | None,
    p95: int | None,
    max_cost_ratio: float | None,
    max_p95_latency_ms: int | None,
) -> list[Check]:
    checks: list[Check] = []
    if max_cost_ratio is not None:
        measured = math.inf if cost_ratio is None else cost_ratio
        checks.append(Check("cost_ratio", max_cost_ratio, measured, measured <= max_cost_ratio))
    if max_p95_latency_ms is not None:
        measured = math.inf if p95 is None else p95
        checks.append(
            Check("p95_latency_ms", max_p95_latency_ms, measured, measured <= max_p95_latency_ms)
        )
    return checks


def _verdict(checks: Sequence[Check]) -> Verdict:
    lower, upper, *limits = checks
    if not upper.passed or not all(check.passed for check in limits):
        return "do_not_switch"
    return "switch" if lower.passed else "inconclusive"


def _floorless_checks(
    value: Interval, margin: float, p95: int | None, max_p95_latency_ms: int | None
) -> tuple[Check, ...]:
    least = 1 - margin
    return (
        Check("agreement_lower_bound", least, value.low, value.low >= least),
        *_limits(None, p95, None, max_p95_latency_ms),
    )


def _floorless_verdict(checks: Sequence[Check]) -> Verdict:
    lower, *limits = checks
    if not all(check.passed for check in limits):
        return "do_not_switch"
    return "switch" if lower.passed else "inconclusive"


def _overall(candidates: Sequence[Candidate]) -> Verdict:
    verdicts = {candidate.verdict for candidate in candidates}
    if "switch" in verdicts:
        return "switch"
    return "inconclusive" if "inconclusive" in verdicts else "do_not_switch"


def _choose(candidates: Sequence[Candidate]) -> Candidate | None:
    switches = [candidate for candidate in candidates if candidate.verdict == "switch"]
    if not switches:
        return None
    return min(
        switches,
        key=lambda candidate: (
            math.inf
            if candidate.usage.cost_per_1k_calls is None
            else candidate.usage.cost_per_1k_calls,
            -candidate.agreement.value,
        ),
    )


def _deployment(config: Mapping[str, Any] | None, name: str) -> Mapping[str, Any] | None:
    for entry in (config or {}).get("model_list", []):
        if entry.get("model_name") == name:
            return entry
    return None


def litellm_change(
    alias: str,
    current: Endpoint | None,
    choice: Endpoint,
    default_url: str,
    config: Mapping[str, Any] | None = None,
    api_key_env: str | None = None,
) -> dict[str, Any]:
    existing = _deployment(config, alias)
    before = (
        dict(existing["litellm_params"])
        if existing
        else {}
        if current is None
        else {"model": current.model}
    )
    found = _deployment(config, choice.model) if choice.base_url == default_url else None
    entry: dict[str, Any] = {"model_name": alias}
    if found is not None:
        after = dict(found["litellm_params"])
        entry["litellm_params"] = after
        if found.get("model_info"):
            entry["model_info"] = dict(found["model_info"])
    elif choice.base_url != default_url:
        after = {"model": f"openai/{choice.model}", "api_base": choice.base_url}
        if api_key_env:
            after["api_key"] = f"os.environ/{api_key_env}"
        entry["litellm_params"] = after
    else:
        after = {"model": choice.model}
        entry["litellm_params"] = after
    return {
        "model_name": alias,
        "before": before,
        "after": after,
        "yaml": yaml.safe_dump({"model_list": [entry]}, sort_keys=False),
    }


def run(
    records: Sequence[DatasetItem],
    render: Render,
    *,
    current: Endpoint,
    candidates: Sequence[Endpoint],
    connect: Callable[[str], Chat],
    agreement: Agreement,
    margin: float,
    task: str,
    alias: str,
    repeats: int = 2,
    params: Mapping[str, Any] | None = None,
    prices: Mapping[str, Price] | None = None,
    max_cost_ratio: float | None = None,
    max_p95_latency_ms: int | None = None,
    litellm_config: Mapping[str, Any] | None = None,
    api_key_env: str | None = None,
    history: History | None = None,
    clock: Clock = time.perf_counter,
    workers: int = 8,
) -> Report:
    if repeats < 2:
        raise ValueError("--repeats must be at least 2: the second run is the noise floor")
    if not records:
        raise ValueError("no records to replay")
    if not candidates:
        raise ValueError("name at least one --candidate")
    settings = dict(params or {})
    priced = dict(prices or {})
    requests = [render(item.input) for item in records]
    recorded = [
        item.outputs[RECORDED].output
        if RECORDED in item.outputs and item.outputs[RECORDED].ok
        else None
        for item in records
    ]
    cases = [Case(item.input_hash, item.input, None) for item in records]
    benchmark = Benchmark(
        f"swap-{task}",
        tuple(
            Case(item.input_hash, item.input, answer)
            for item, answer in zip(records, recorded, strict=True)
        ),
    )

    def ask(endpoint: Endpoint) -> list[Answer]:
        return replay(connect(endpoint.base_url), endpoint, requests, settings, clock, workers)

    current_runs = [ask(current) for _ in range(repeats)]
    reference = _texts(current_runs[0])
    current_answers = [answer for answers in current_runs for answer in answers]
    noise = _mean_of(
        [_scored(cases, answers, reference, agreement) for answers in current_runs[1:]], cases
    )
    has_recorded = any(answer is not None for answer in recorded)
    current_price = _price_of(priced, current)
    current_usage = _usage(current_answers, agreement, current_price)
    self_value = _interval(noise)
    current_run_id = (
        history.record(
            benchmark, current.label, noise, {"self_agreement": MetricValue(**asdict(self_value))}
        )
        if history is not None
        else None
    )
    summary = Current(
        endpoint=current.label,
        model=current.model,
        base_url=current.base_url,
        usage=current_usage,
        self_agreement=self_value,
        agreement_with_recorded=(
            _interval(_scored(cases, current_runs[0], recorded, agreement))
            if has_recorded
            else None
        ),
        run_id=current_run_id,
    )
    judged: list[Candidate] = []
    for endpoint in candidates:
        answers = ask(endpoint)
        result = _scored(cases, answers, reference, agreement)
        gap = compare(noise, result)
        usage = _usage(answers, agreement, _price_of(priced, endpoint))
        cost_ratio = (
            usage.cost_per_1k_calls / current_usage.cost_per_1k_calls
            if usage.cost_per_1k_calls is not None and current_usage.cost_per_1k_calls
            else None
        )
        checks = _checks(
            gap, margin, cost_ratio, usage.p95_latency_ms, max_cost_ratio, max_p95_latency_ms
        )
        value = _interval(result)
        run_id = (
            history.record(
                benchmark,
                endpoint.label,
                result,
                {
                    "agreement": MetricValue(**asdict(value)),
                    "self_agreement": MetricValue(**asdict(self_value)),
                    "agreement_gap": MetricValue(gap.difference, gap.low, gap.high),
                },
            )
            if history is not None
            else None
        )
        judged.append(
            Candidate(
                endpoint=endpoint.label,
                model=endpoint.model,
                base_url=endpoint.base_url,
                usage=usage,
                agreement=value,
                agreement_with_recorded=(
                    _interval(_scored(cases, answers, recorded, agreement))
                    if has_recorded
                    else None
                ),
                gap=Gap(gap.difference, gap.low, gap.high, gap.fixed, gap.broken),
                cost_ratio=cost_ratio,
                checks=checks,
                verdict=_verdict(checks),
                run_id=run_id,
            )
        )
    chosen = _choose(judged)
    by_label = {endpoint.label: endpoint for endpoint in candidates}
    return Report(
        task=task,
        metric=agreement.name,
        margin=margin,
        cases=len(records),
        repeats=repeats,
        current=summary,
        candidates=tuple(judged),
        decision=_overall(judged),
        choice=None if chosen is None else chosen.endpoint,
        litellm=(
            None
            if chosen is None
            else litellm_change(
                alias,
                current,
                by_label[chosen.endpoint],
                current.base_url,
                litellm_config,
                api_key_env,
            )
        ),
    )


def recorded_teacher(text: str) -> str | None:
    head, _, key = text.partition(":")
    if head != RECORDED_MODE:
        return None
    return key or RECORDED


def parse_interval(text: str) -> Interval:
    values = [float(part) for part in text.split(",")]
    if len(values) == 1:
        return Interval(values[0], values[0], values[0])
    if len(values) != 3 or not values[1] <= values[0] <= values[2]:
        raise ValueError(f"{text!r} is not VALUE or VALUE,LOW,HIGH with LOW <= VALUE <= HIGH")
    return Interval(values[0], values[1], values[2])


def _stored(item: DatasetItem, key: str) -> str | None:
    found = item.outputs.get(key)
    return found.output if found is not None and found.ok else None


def _viewed(texts: Sequence[str | None], view: View | None) -> list[str | None]:
    present = [text for text in texts if text is not None]
    if view is None or not present:
        return list(texts)
    mapped = list(view(present))
    if len(mapped) != len(present):
        raise ValueError(f"the view returned {len(mapped)} answers for {len(present)}")
    found = iter(mapped)
    return [None if text is None else next(found) for text in texts]


def _viewed_answers(answers: Sequence[Answer], view: View | None) -> list[Answer]:
    texts = _viewed([answer.text for answer in answers], view)
    return [replace(answer, text=text) for answer, text in zip(answers, texts, strict=True)]


def _recorded_answer(text: str | None) -> Answer:
    return Answer(text, None if text is not None else "no recorded answer", 0.0, 0, 0)


def _strata(result: RunResult, labels: Sequence[str]) -> tuple[Stratum, ...]:
    groups: dict[str, list[float]] = {}
    for label, scored in zip(labels, result.scores, strict=True):
        groups.setdefault(label, []).append(scored.score)
    return tuple(
        Stratum(name, len(values), Interval(**asdict(mean_interval(values))))
        for name, values in sorted(groups.items())
    )


def _unpaired_gap(floor: Interval, value: Interval) -> Gap:
    return Gap(
        value.value - floor.value, value.low - floor.high, value.high - floor.low, None, None
    )


@dataclass(frozen=True)
class _Noise:
    floor: Interval | None
    source: NoiseSource
    indices: list[int]
    result: RunResult | None


def _noise(
    chosen: Sequence[DatasetItem],
    reference: Sequence[str | None],
    repeat_key: str,
    provided: Interval | None,
    view: View | None,
    metric: Agreement,
) -> _Noise:
    if provided is not None:
        return _Noise(provided, "provided", [], None)
    indices = [index for index, item in enumerate(chosen) if _stored(item, repeat_key) is not None]
    if not indices:
        return _Noise(None, "not_measured", [], None)
    repeats = _viewed([_stored(chosen[index], repeat_key) for index in indices], view)
    result = _scored(
        [Case(chosen[index].input_hash, None, None) for index in indices],
        [_recorded_answer(text) for text in repeats],
        [reference[index] for index in indices],
        metric,
    )
    return _Noise(_interval(result), "repeats", indices, result)


def _subset(
    cases: Sequence[Case],
    answers: Sequence[Answer],
    reference: Sequence[str | None],
    indices: Sequence[int],
    metric: Agreement,
) -> RunResult:
    return _scored(
        [cases[index] for index in indices],
        [answers[index] for index in indices],
        [reference[index] for index in indices],
        metric,
    )


def _recorded_gap(
    noise: _Noise,
    value: Interval,
    paired: RunResult | None,
) -> Gap | None:
    if noise.result is not None and paired is not None:
        found = compare(noise.result, paired)
        return Gap(found.difference, found.low, found.high, found.fixed, found.broken)
    if noise.floor is not None:
        return _unpaired_gap(noise.floor, value)
    return None


def _recorded_decision(
    gap: Gap | None,
    value: Interval,
    margin: float,
    p95: int | None,
    max_p95_latency_ms: int | None,
) -> tuple[tuple[Check, ...], Verdict]:
    if gap is None:
        checks = _floorless_checks(value, margin, p95, max_p95_latency_ms)
        return checks, _floorless_verdict(checks)
    checks = _checks(gap, margin, None, p95, None, max_p95_latency_ms)
    return checks, _verdict(checks)


def run_recorded(
    records: Sequence[DatasetItem],
    render: Render,
    *,
    teacher: str,
    candidates: Sequence[Endpoint],
    connect: Callable[[str], Chat],
    agreement: Agreement,
    margin: float,
    task: str,
    alias: str,
    base_url: str,
    view: View | None = None,
    stratify: Stratify | None = None,
    self_agreement: Interval | None = None,
    repeat_key: str | None = None,
    params: Mapping[str, Any] | None = None,
    prices: Mapping[str, Price] | None = None,
    max_cost_ratio: float | None = None,
    max_p95_latency_ms: int | None = None,
    litellm_config: Mapping[str, Any] | None = None,
    api_key_env: str | None = None,
    history: History | None = None,
    clock: Clock = time.perf_counter,
    workers: int = 8,
) -> Report:
    if max_cost_ratio is not None:
        raise ValueError(
            "--max-cost-ratio needs a live current model: recorded answers have no cost"
        )
    if not candidates:
        raise ValueError("name at least one --candidate")
    chosen = [item for item in records if _stored(item, teacher) is not None]
    if not chosen:
        raise ValueError(f"no record holds an answer from {teacher!r}")
    settings = dict(params or {})
    priced = dict(prices or {})
    reference = _viewed([_stored(item, teacher) for item in chosen], view)
    requests = [render(item.input) for item in chosen]
    cases = [Case(item.input_hash, item.input, None) for item in chosen]
    labels = None if stratify is None else [stratify(text) for text in reference]
    benchmark = Benchmark(
        f"swap-{task}",
        tuple(
            Case(item.input_hash, item.input, text)
            for item, text in zip(chosen, reference, strict=True)
        ),
    )
    noise = _noise(
        chosen,
        reference,
        repeat_key or f"{teacher}{REPEAT_SUFFIX}",
        self_agreement,
        view,
        agreement,
    )
    label = f"{RECORDED_MODE}:{teacher}"
    floor_metrics = (
        {} if noise.floor is None else {"self_agreement": MetricValue(**asdict(noise.floor))}
    )
    current = RecordedCurrent(
        endpoint=label,
        teacher=teacher,
        cases=len(chosen),
        skipped=len(records) - len(chosen),
        unreadable=sum(1 for text in reference if text is None or not agreement.readable(text)),
        noise_floor=noise.floor,
        noise_source=noise.source,
        noise_cases=len(noise.indices),
        run_id=(
            history.record(benchmark, label, noise.result, floor_metrics)
            if history is not None and noise.result is not None
            else None
        ),
    )
    judged: list[Candidate] = []
    for endpoint in candidates:
        answers = _viewed_answers(
            replay(connect(endpoint.base_url), endpoint, requests, settings, clock, workers), view
        )
        result = _scored(cases, answers, reference, agreement)
        value = _interval(result)
        usage = _usage(answers, agreement, _price_of(priced, endpoint))
        paired = (
            None
            if noise.result is None
            else _subset(cases, answers, reference, noise.indices, agreement)
        )
        gap = _recorded_gap(noise, value, paired)
        checks, verdict = _recorded_decision(
            gap, value, margin, usage.p95_latency_ms, max_p95_latency_ms
        )
        metrics: dict[str, MetricValue] = {"agreement": MetricValue(**asdict(value))}
        if gap is not None:
            metrics.update(floor_metrics)
            metrics["agreement_gap"] = MetricValue(gap.difference, gap.low, gap.high)
        judged.append(
            Candidate(
                endpoint=endpoint.label,
                model=endpoint.model,
                base_url=endpoint.base_url,
                usage=usage,
                agreement=value,
                agreement_with_recorded=None,
                gap=gap,
                cost_ratio=None,
                checks=checks,
                verdict=verdict,
                run_id=(
                    history.record(benchmark, endpoint.label, result, metrics)
                    if history is not None
                    else None
                ),
                strata=() if labels is None else _strata(result, labels),
            )
        )
    picked = _choose(judged)
    by_label = {endpoint.label: endpoint for endpoint in candidates}
    return Report(
        task=task,
        metric=agreement.name,
        margin=margin,
        cases=len(chosen),
        repeats=0,
        current=current,
        candidates=tuple(judged),
        decision=_overall(judged),
        choice=None if picked is None else picked.endpoint,
        litellm=(
            None
            if picked is None
            else litellm_change(
                alias, None, by_label[picked.endpoint], base_url, litellm_config, api_key_env
            )
        ),
    )


def add_parser(groups: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    parser = groups.add_parser("swap", help="decide a model or provider swap on recorded calls")
    parser.add_argument("spec", type=Path)
    parser.add_argument("--records", type=Path, required=True, help="dataset JSONL to replay")
    parser.add_argument(
        "--current",
        required=True,
        help="model serving the task today, or recorded[:<teacher-key>] for its stored answers",
    )
    parser.add_argument(
        "--candidate",
        action="append",
        dest="candidates",
        required=True,
        help="model or model@base-url; repeat it, also for one model on several URLs",
    )
    parser.add_argument("--base-url", required=True, help="OpenAI-compatible URL, e.g. LiteLLM")
    parser.add_argument("--api-key-env", default="LITELLM_API_KEY")
    parser.add_argument("--sample", type=int, help="replay this many records (fixed by --seed)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--repeats", type=int, default=2, help="runs of the current model")
    parser.add_argument("--metric", help="exact, json, set_f1 or module:attr (default: the spec's)")
    parser.add_argument("--prompt", help="module:attr building messages from (system, input)")
    parser.add_argument("--margin", type=float, help="allowed agreement gap (default: the gate's)")
    parser.add_argument("--prices", type=Path, help="prices YAML or a LiteLLM config")
    parser.add_argument("--litellm-config", type=Path, help="LiteLLM config for prices and params")
    parser.add_argument("--alias", help="LiteLLM model_name to change (default: the spec's)")
    parser.add_argument("--max-cost-ratio", type=float)
    parser.add_argument("--max-p95-latency-ms", type=int)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--max-tokens", type=int)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--history", type=Path, default=Path("history.jsonl"))
    parser.add_argument("--out", type=Path, help="write the JSON report here")
    parser.add_argument("--view", help="recorded mode: module:attr mapping answers before scoring")
    parser.add_argument("--stratify", help="recorded mode: module:attr naming each record's group")
    parser.add_argument(
        "--self-agreement", help="recorded mode: noise floor as VALUE or VALUE,LOW,HIGH"
    )
    parser.add_argument(
        "--repeat-key", help="recorded mode: output key of repeated answers (<teacher>_repeat)"
    )


def _shown(value: Interval) -> str:
    return f"{value.value:.3f} [{value.low:.3f}, {value.high:.3f}]"


def _floor_line(current: Current | RecordedCurrent) -> str:
    if isinstance(current, Current):
        return f"{current.endpoint} vs itself: {_shown(current.self_agreement)}"
    head = f"{current.endpoint}: {current.cases} records, {current.skipped} without an answer"
    if current.noise_floor is None:
        return f"{head}\nnoise floor: not measured"
    source = (
        "provided"
        if current.noise_source == "provided"
        else f"{current.noise_source}, {current.noise_cases} records"
    )
    return f"{head}\nnoise floor: {_shown(current.noise_floor)} ({source})"


def _candidate_lines(candidate: Candidate, current: str) -> list[str]:
    gap = candidate.gap
    compared = (
        "no gap without a noise floor"
        if gap is None
        else f"gap {gap.difference:+.3f} [{gap.low:+.3f}, {gap.high:+.3f}]"
    )
    lines = [
        f"{candidate.endpoint} vs {current}: {_shown(candidate.agreement)}, {compared} "
        f"-> {candidate.verdict}"
    ]
    lines.extend(
        f"  {stratum.name} ({stratum.cases}): {_shown(stratum.agreement)}"
        for stratum in candidate.strata
    )
    return lines


def _summary(report: Report) -> str:
    lines = [_floor_line(report.current)]
    for candidate in report.candidates:
        lines.extend(_candidate_lines(candidate, report.current.endpoint))
    lines.append(f"decision: {report.decision}" + (f" ({report.choice})" if report.choice else ""))
    if report.litellm is not None:
        lines.append(report.litellm["yaml"].rstrip())
    return "\n".join(lines)


def _recorded_options(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "view": _attribute(args.view) if args.view else None,
        "stratify": _attribute(args.stratify) if args.stratify else None,
        "self_agreement": parse_interval(args.self_agreement) if args.self_agreement else None,
        "repeat_key": args.repeat_key,
    }


def main(args: argparse.Namespace) -> int:
    teacher = recorded_teacher(args.current)
    if teacher is None and (args.view or args.stratify or args.self_agreement or args.repeat_key):
        raise ValueError(
            "--view, --stratify, --self-agreement and --repeat-key need --current recorded"
        )
    if teacher is None and args.repeats < 2:
        raise ValueError("--repeats must be at least 2: the second run is the noise floor")
    spec = load_spec(args.spec)
    margin = args.margin
    if margin is None:
        margin = spec.eval.gate.max_regression
    if margin is None:
        margin = DEFAULT_MARGIN
    config = yaml.safe_load(args.litellm_config.read_text()) if args.litellm_config else None
    prices = prices_from_config(config) if config else {}
    if args.prices:
        prices.update(load_prices(args.prices))
    key = os.environ.get(args.api_key_env, "")
    clients: dict[str, Chat] = {}

    def connect(url: str) -> Chat:
        if url not in clients:
            clients[url] = ChatClient(url, api_key=key, timeout=args.timeout)
        return clients[url]

    params: dict[str, Any] = {"temperature": args.temperature}
    if args.max_tokens is not None:
        params["max_tokens"] = args.max_tokens
    records = sample_items(DatasetStore(args.records).load(), args.sample, args.seed)
    render = render_for(args.spec, args.prompt)
    shared: dict[str, Any] = {
        "candidates": [parse_endpoint(text, args.base_url) for text in args.candidates],
        "connect": connect,
        "agreement": agreement_for(spec, args.metric),
        "margin": margin,
        "task": spec.task,
        "alias": args.alias or spec.serve.litellm_alias,
        "params": params,
        "prices": prices,
        "max_cost_ratio": args.max_cost_ratio,
        "max_p95_latency_ms": args.max_p95_latency_ms,
        "litellm_config": config,
        "api_key_env": args.api_key_env,
        "history": History(args.history),
        "workers": args.workers,
    }
    if teacher is None:
        report = run(
            records,
            render,
            current=parse_endpoint(args.current, args.base_url),
            repeats=args.repeats,
            **shared,
        )
    else:
        report = run_recorded(
            records,
            render,
            teacher=teacher,
            base_url=args.base_url,
            **_recorded_options(args),
            **shared,
        )
    text = json.dumps(report.to_json(), indent=2, default=str)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
        print(_summary(report))
    else:
        print(text)
    return 0
