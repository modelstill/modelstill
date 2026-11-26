import json
import re
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import pytest
import yaml

from modelstill import push, swap
from modelstill.benchmark import History
from modelstill.cli import main
from modelstill.client import ChatError, ChatReply
from modelstill.data import DatasetItem, DatasetStore, Provenance, TeacherOutput
from modelstill.spec import load_spec
from modelstill.stats import clopper_pearson

LITELLM = "http://litellm:4000"
SPEC = """
task: tagging
version: 1
instruction: prompts/system.md
output_schema: schemas/out.json
requirements:
  - id: tags
    priority: p0
    type: set_f1
    instruction: Every tag, nothing else.
labelling:
  teachers:
    - {model: a/one, family: a}
    - {model: b/two, family: b}
eval:
  judge: {model: c/three, family: c}
  golden_set: data/gold.jsonl
  gate:
    metric: tags
    max_regression: 0.05
    max_flip_rate: 0.01
    max_cost_ratio: 0.6
    max_p95_latency_ms: 4000
train: {base: Qwen/Qwen3-1.7B, method: lora, seeds: [1]}
serve: {litellm_alias: tagging, fallback: tagging-cloud, target_error: 0.05}
monitor: {canary: data/canary.jsonl, replay_frac: 0.1}
"""

Responder = Callable[[str, str], str]


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class FakeChat:
    def __init__(self, responder: Responder, clock: Clock, latency_ms: float = 100.0) -> None:
        self.responder = responder
        self.clock = clock
        self.latency_ms = latency_ms
        self.calls: list[tuple[str, list[dict[str, str]], dict[str, Any]]] = []

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        self.calls.append((model, messages, params))
        self.clock.now += self.latency_ms / 1000
        text = self.responder(model, messages[-1]["content"])
        if text == "boom":
            raise ChatError("500: upstream")
        return ChatReply(text, model, 1000, 100, None)


def tags(*names: str) -> str:
    return json.dumps({"tags": list(names)})


def items(count: int = 300) -> list[DatasetItem]:
    return [
        DatasetItem.create(
            {"text": f"posting {n}"},
            Provenance("fixture", {"id": str(n)}, "test"),
            {"production": TeacherOutput(output=tags(f"t{n}"))},
        )
        for n in range(count)
    ]


def number(text: str) -> int:
    found = re.search(r"\d+", text)
    assert found is not None
    return int(found.group())


def same(model: str, text: str) -> str:
    return tags(f"t{number(text)}")


def spec_dir(tmp_path: Path) -> Path:
    (tmp_path / "prompts").mkdir(parents=True)
    (tmp_path / "prompts" / "system.md").write_text("Tag the posting.")
    (tmp_path / "spec.yaml").write_text(SPEC)
    return tmp_path / "spec.yaml"


def run_swap(
    responders: dict[str, Responder],
    candidates: list[str],
    count: int = 300,
    latency: dict[str, float] | None = None,
    **options: Any,
) -> tuple[swap.Report, dict[str, FakeChat]]:
    clock = Clock()
    chats: dict[str, FakeChat] = {}

    def connect(url: str) -> FakeChat:
        chats.setdefault(url, FakeChat(lambda model, text: responders[model](model, text), clock))
        chats[url].latency_ms = (latency or {}).get(url, 100.0)
        return chats[url]

    report = swap.run(
        items(count),
        swap.render_with_system("Tag the posting."),
        current=swap.parse_endpoint("old", LITELLM),
        candidates=[swap.parse_endpoint(text, LITELLM) for text in candidates],
        connect=connect,
        agreement=swap.agreement("set_f1"),
        margin=options.pop("margin", 0.05),
        clock=clock,
        workers=1,
        task="tagging",
        alias="tagging",
        **options,
    )
    return report, chats


def live(report: swap.Report) -> swap.Current:
    assert isinstance(report.current, swap.Current)
    return report.current


def test_an_endpoint_may_name_its_own_base_url() -> None:
    plain = swap.parse_endpoint("qwen/qwen3.7-flash", LITELLM)
    pinned = swap.parse_endpoint("qwen/qwen3.7-flash@http://vllm:8000", LITELLM)

    assert (plain.model, plain.base_url, plain.label) == (
        "qwen/qwen3.7-flash",
        LITELLM,
        "qwen/qwen3.7-flash",
    )
    assert (pinned.base_url, pinned.label) == (
        "http://vllm:8000",
        "qwen/qwen3.7-flash@http://vllm:8000",
    )


def test_set_f1_agreement_reads_the_list_inside_a_json_answer() -> None:
    metric = swap.agreement("set_f1")

    assert metric.score(tags("a", "b"), tags("b", "a")) == 1.0
    assert metric.score(tags("a"), tags("a", "b")) == pytest.approx(2 / 3)
    assert metric.readable(tags()) and not metric.readable("not json")


def test_json_agreement_ignores_key_order_and_exact_ignores_outer_space() -> None:
    assert swap.agreement("json").score('{"a": 1, "b": 2}', '{"b":2,"a":1}') == 1.0
    assert swap.agreement("exact").score(" yes\n", "yes") == 1.0
    assert not swap.agreement("exact").readable("  ")


def test_a_task_metric_can_be_loaded_by_module_and_attribute() -> None:
    metric = swap.agreement("modelstill.evals:exact_match")

    assert metric.score("x", "x") == 1.0 and metric.score("x", "y") == 0.0


def test_the_spec_gate_metric_picks_the_agreement(tmp_path: Path) -> None:
    spec = load_spec(spec_dir(tmp_path))

    assert swap.agreement_for(spec, None).name == "set_f1"
    assert swap.agreement_for(spec, "json").name == "json"


def test_records_render_through_the_spec_instruction(tmp_path: Path) -> None:
    render = swap.render_for(spec_dir(tmp_path), None)

    assert render({"text": "hi"}) == [
        {"role": "system", "content": "Tag the posting."},
        {"role": "user", "content": '{"text": "hi"}'},
    ]
    assert render({"messages": [{"role": "user", "content": "x"}]}) == [
        {"role": "user", "content": "x"}
    ]
    assert swap.render_for(spec_dir(tmp_path / "b"), "test_swap:_user_only")("q") == [
        {"role": "user", "content": "Tag the posting.|q"}
    ]


def _user_only(system: str, value: Any) -> list[dict[str, str]]:
    return [{"role": "user", "content": f"{system}|{value}"}]


def test_a_candidate_that_agrees_like_the_current_model_is_a_switch() -> None:
    report, chats = run_swap({"old": same, "new": same}, ["new"])

    [candidate] = report.candidates
    assert live(report).self_agreement.value == 1.0
    assert candidate.agreement.value == 1.0
    assert candidate.verdict == "switch"
    assert report.decision == "switch" and report.choice == "new"
    assert len(chats[LITELLM].calls) == 300 * 3


def test_binary_agreement_carries_an_exact_interval() -> None:
    def half(model: str, text: str) -> str:
        return same(model, text) if number(text) % 2 else tags("other")

    report, _ = run_swap({"old": same, "new": half}, ["new"])

    [candidate] = report.candidates
    assert (candidate.agreement.low, candidate.agreement.high) == pytest.approx(
        clopper_pearson(150, 300)
    )
    assert candidate.verdict == "do_not_switch"
    assert candidate.gap is not None
    assert candidate.gap.broken == 150 and candidate.gap.fixed == 0


def test_a_small_unclear_gap_is_inconclusive() -> None:
    def mostly(model: str, text: str) -> str:
        return tags("other") if number(text) % 10 == 0 else same(model, text)

    report, _ = run_swap({"old": same, "new": mostly}, ["new"], count=40)

    assert report.candidates[0].verdict == "inconclusive"
    assert report.decision == "inconclusive" and report.choice is None
    assert report.litellm is None


def test_every_check_keeps_its_threshold_and_measured_value() -> None:
    report, _ = run_swap({"old": same, "new": same}, ["new"])

    gap = report.candidates[0].checks[0]
    assert (gap.name, gap.threshold, gap.value, gap.passed) == (
        "agreement_gap_lower_bound",
        -0.05,
        0.0,
        True,
    )


def test_the_noise_floor_shows_a_current_model_that_disagrees_with_itself() -> None:
    seen: dict[str, int] = {}

    def flaky(model: str, text: str) -> str:
        seen[text] = seen.get(text, 0) + 1
        return same(model, text) if seen[text] == 1 or number(text) % 4 else tags("x")

    report, _ = run_swap({"old": flaky, "new": same}, ["new"])

    assert live(report).self_agreement.value == pytest.approx(0.75)
    assert report.candidates[0].agreement.value == pytest.approx(1.0)


def test_unreadable_answers_and_errors_count_against_the_endpoint() -> None:
    def broken(model: str, text: str) -> str:
        left = number(text) % 3
        return "boom" if left == 0 else "not json" if left == 1 else same(model, text)

    report, _ = run_swap({"old": same, "new": broken}, ["new"], count=30)

    usage = report.candidates[0].usage
    assert usage.calls == 30 and usage.unreadable == 20
    assert usage.unreadable_rate.value == pytest.approx(2 / 3)
    assert live(report).usage.unreadable == 0


def test_cost_per_thousand_calls_and_latency_percentiles() -> None:
    prices = {"old": swap.Price(1e-6, 2e-6), "new": swap.Price(1e-7, 2e-7)}
    report, _ = run_swap(
        {"old": same, "new": same},
        ["new@http://fast:8000"],
        prices=prices,
        latency={LITELLM: 400.0, "http://fast:8000": 50.0},
    )

    current, candidate = live(report).usage, report.candidates[0].usage
    assert current.cost_per_1k_calls == pytest.approx(1.2)
    assert candidate.cost_per_1k_calls == pytest.approx(0.12)
    assert report.candidates[0].cost_ratio == pytest.approx(0.1)
    assert (current.p50_latency_ms, current.p95_latency_ms) == (400, 400)
    assert candidate.p95_latency_ms == 50


def test_prices_load_from_a_small_file_or_a_litellm_config(tmp_path: Path) -> None:
    small = tmp_path / "prices.yaml"
    small.write_text(yaml.safe_dump({"old": {"input_cost_per_token": 1e-6}}))
    config = tmp_path / "config.yaml"
    config.write_text(
        yaml.safe_dump(
            {
                "model_list": [
                    {
                        "model_name": "new",
                        "litellm_params": {"model": "openrouter/x/new"},
                        "model_info": {"input_cost_per_token": 2e-7, "output_cost_per_token": 4e-7},
                    }
                ]
            }
        )
    )

    assert swap.load_prices(small) == {"old": swap.Price(1e-6, 0.0)}
    assert swap.load_prices(config) == {"new": swap.Price(2e-7, 4e-7)}


def test_a_provider_matrix_sends_one_model_to_several_base_urls() -> None:
    report, chats = run_swap({"old": same, "m": same}, ["m@http://a:1", "m@http://b:1"], count=20)

    assert [candidate.endpoint for candidate in report.candidates] == [
        "m@http://a:1",
        "m@http://b:1",
    ]
    assert len(chats["http://a:1"].calls) == len(chats["http://b:1"].calls) == 20


def test_the_cheapest_switch_is_chosen_with_its_litellm_change() -> None:
    prices = {
        "old": swap.Price(1e-6, 1e-6),
        "m@http://a:1": swap.Price(5e-7, 5e-7),
        "m@http://b:1": swap.Price(1e-7, 1e-7),
    }
    report, _ = run_swap(
        {"old": same, "m": same},
        ["m@http://a:1", "m@http://b:1"],
        prices=prices,
        api_key_env="LITELLM_KEY",
    )

    assert report.choice == "m@http://b:1"
    assert report.litellm is not None
    assert report.litellm["before"] == {"model": "old"}
    assert report.litellm["after"] == {
        "model": "openai/m",
        "api_base": "http://b:1",
        "api_key": "os.environ/LITELLM_KEY",
    }
    assert yaml.safe_load(report.litellm["yaml"]) == {
        "model_list": [{"model_name": "tagging", "litellm_params": report.litellm["after"]}]
    }


def test_a_litellm_config_supplies_the_exact_deployment_params() -> None:
    config = {
        "model_list": [
            {"model_name": "tagging", "litellm_params": {"model": "openrouter/x/old"}},
            {
                "model_name": "new",
                "litellm_params": {"model": "openrouter/y/new", "max_tokens": 512},
                "model_info": {"input_cost_per_token": 1e-7},
            },
        ]
    }
    report, _ = run_swap({"old": same, "new": same}, ["new"], litellm_config=config)

    assert report.litellm is not None
    assert report.litellm["before"] == {"model": "openrouter/x/old"}
    assert yaml.safe_load(report.litellm["yaml"])["model_list"][0] == {
        "model_name": "tagging",
        "litellm_params": {"model": "openrouter/y/new", "max_tokens": 512},
        "model_info": {"input_cost_per_token": 1e-7},
    }


def test_agreement_with_the_recorded_production_answer_is_reported() -> None:
    def other(model: str, text: str) -> str:
        return tags("z")

    report, _ = run_swap({"old": other, "new": same}, ["new"], count=50)

    recorded = live(report).agreement_with_recorded
    assert recorded is not None
    assert recorded.value == 0.0
    assert report.candidates[0].agreement_with_recorded is not None
    assert report.candidates[0].agreement_with_recorded.value == 1.0


def test_cost_and_latency_limits_become_checks() -> None:
    prices = {"old": swap.Price(1e-7, 1e-7), "new": swap.Price(1e-6, 1e-6)}
    report, _ = run_swap(
        {"old": same, "new": same},
        ["new"],
        prices=prices,
        max_cost_ratio=1.0,
        max_p95_latency_ms=50,
    )

    checks = {check.name: check for check in report.candidates[0].checks}
    assert checks["cost_ratio"].value == pytest.approx(10.0) and not checks["cost_ratio"].passed
    assert checks["p95_latency_ms"].threshold == 50 and not checks["p95_latency_ms"].passed
    assert report.candidates[0].verdict == "do_not_switch"


def test_sampling_takes_a_fixed_subset() -> None:
    first = swap.sample_items(items(100), 10, seed=3)

    assert len(first) == 10
    assert first == swap.sample_items(items(100), 10, seed=3)
    assert swap.sample_items(items(5), 10, seed=3) == items(5)


def test_the_run_is_recorded_so_push_run_can_send_it(tmp_path: Path) -> None:
    history = History(tmp_path / "history.jsonl")
    report, _ = run_swap({"old": same, "new": same}, ["new"], count=20, history=history)

    [candidate] = report.candidates
    assert candidate.run_id is not None and report.current.run_id is not None
    entry = history.get(candidate.run_id)
    assert entry.model == "new"
    assert entry.benchmark == "swap-tagging"
    assert set(entry.metrics) == {"agreement", "self_agreement", "agreement_gap"}
    payload = push.run_payload(entry, "agreement", "gold")
    assert payload["primaryMetric"] == "agreement" and len(payload["cases"]) == 20


def test_the_report_is_plain_json() -> None:
    report, _ = run_swap({"old": same, "new": same}, ["new"], count=20)

    data = json.loads(json.dumps(report.to_json()))
    assert data["decision"] == "switch"
    assert data["candidates"][0]["checks"][0]["name"] == "agreement_gap_lower_bound"
    assert set(data["current"]["usage"]) >= {
        "cost_per_1k_calls",
        "p50_latency_ms",
        "p95_latency_ms",
        "unreadable_rate",
    }


def test_the_cli_runs_a_swap_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    spec = spec_dir(tmp_path)
    records = tmp_path / "records.jsonl"
    DatasetStore(records).add(items(30))
    clock = Clock()
    made: list[tuple[str, str]] = []

    def client(base_url: str, api_key: str, **_: Any) -> FakeChat:
        made.append((base_url, api_key))
        return FakeChat(same, clock)

    monkeypatch.setattr(swap, "ChatClient", client)
    monkeypatch.setenv("LITELLM_API_KEY", "sk-test")
    out = tmp_path / "report.json"

    code = main(
        [
            "swap",
            str(spec),
            "--records",
            str(records),
            "--current",
            "old",
            "--candidate",
            "new",
            "--base-url",
            LITELLM,
            "--sample",
            "20",
            "--history",
            str(tmp_path / "history.jsonl"),
            "--out",
            str(out),
        ]
    )

    assert code == 0
    report = json.loads(out.read_text())
    assert report["decision"] == "switch" and report["cases"] == 20
    assert report["margin"] == 0.05
    assert made[0] == (LITELLM, "sk-test")
    assert "switch" in capsys.readouterr().out
    assert len(History(tmp_path / "history.jsonl").runs()) == 2


def test_the_cli_needs_two_repeats_for_a_noise_floor(tmp_path: Path) -> None:
    code = main(
        [
            "swap",
            str(spec_dir(tmp_path)),
            "--records",
            str(tmp_path / "none.jsonl"),
            "--current",
            "old",
            "--candidate",
            "new",
            "--base-url",
            LITELLM,
            "--repeats",
            "1",
        ]
    )

    assert code == 1


def recorded_items(
    count: int, answer: Callable[[int], str | None], repeat: Callable[[int], str | None]
) -> list[DatasetItem]:
    found: list[DatasetItem] = []
    for n in range(count):
        outputs: dict[str, TeacherOutput] = {}
        if (text := answer(n)) is not None:
            outputs["production"] = TeacherOutput(output=text)
        if (again := repeat(n)) is not None:
            outputs["production_repeat"] = TeacherOutput(output=again)
        found.append(
            DatasetItem.create(
                {"text": f"posting {n}"}, Provenance("fixture", {"id": str(n)}, "test"), outputs
            )
        )
    return found


def no_repeat(n: int) -> str | None:
    return None


def run_recorded(
    responders: dict[str, Responder],
    candidates: list[str],
    records: list[DatasetItem] | None = None,
    **options: Any,
) -> tuple[swap.Report, dict[str, FakeChat]]:
    clock = Clock()
    chats: dict[str, FakeChat] = {}

    def connect(url: str) -> FakeChat:
        chats.setdefault(url, FakeChat(lambda model, text: responders[model](model, text), clock))
        return chats[url]

    report = swap.run_recorded(
        items(300) if records is None else records,
        swap.render_with_system("Tag the posting."),
        teacher=options.pop("teacher", "production"),
        candidates=[swap.parse_endpoint(text, LITELLM) for text in candidates],
        connect=connect,
        agreement=options.pop("agreement", swap.agreement("set_f1")),
        margin=options.pop("margin", 0.05),
        clock=clock,
        workers=1,
        task="tagging",
        alias="tagging",
        base_url=LITELLM,
        **options,
    )
    return report, chats


def half(model: str, text: str) -> str:
    return same(model, text) if number(text) % 2 else tags("other")


def test_recorded_mode_never_calls_the_current_model() -> None:
    report, chats = run_recorded({"new": same}, ["new"])

    assert {call[0] for call in chats[LITELLM].calls} == {"new"}
    assert len(chats[LITELLM].calls) == 300
    assert isinstance(report.current, swap.RecordedCurrent)
    assert report.current.teacher == "production"
    assert report.current.cases == 300 and report.current.skipped == 0
    assert report.repeats == 0
    [candidate] = report.candidates
    assert candidate.agreement.value == 1.0
    assert (candidate.agreement.low, candidate.agreement.high) == pytest.approx(
        clopper_pearson(300, 300)
    )
    assert candidate.usage.answered_by == {"new": 300}


def test_without_a_noise_floor_it_is_not_invented_and_only_a_near_perfect_match_switches() -> None:
    report, _ = run_recorded({"new": same, "half": half}, ["new", "half"])

    assert isinstance(report.current, swap.RecordedCurrent)
    assert report.current.noise_floor is None
    assert report.current.noise_source == "not_measured"
    good, bad = report.candidates
    assert good.gap is None and bad.gap is None
    check = good.checks[0]
    assert (check.name, check.threshold) == ("agreement_lower_bound", pytest.approx(0.95))
    assert good.verdict == "switch"
    assert bad.verdict == "inconclusive"
    assert report.decision == "switch" and report.choice == "new"


def test_a_provided_self_agreement_is_the_noise_floor_for_an_unpaired_gap() -> None:
    floor = swap.Interval(0.95, 0.91, 0.98)
    report, _ = run_recorded({"half": half}, ["half"], self_agreement=floor)

    assert isinstance(report.current, swap.RecordedCurrent)
    assert report.current.noise_floor == floor
    assert report.current.noise_source == "provided"
    [candidate] = report.candidates
    value = candidate.agreement
    assert candidate.gap is not None
    assert candidate.gap.difference == pytest.approx(value.value - 0.95)
    assert candidate.gap.low == pytest.approx(value.low - 0.98)
    assert candidate.gap.high == pytest.approx(value.high - 0.91)
    assert candidate.gap.fixed is None and candidate.gap.broken is None
    assert candidate.verdict == "do_not_switch"


def test_repeated_recorded_answers_give_a_paired_noise_floor() -> None:
    def repeat(n: int) -> str | None:
        if n >= 100:
            return None
        return tags(f"t{n}") if n % 4 else tags("x")

    records = recorded_items(300, lambda n: tags(f"t{n}"), repeat)
    report, _ = run_recorded({"new": same}, ["new"], records=records)

    assert isinstance(report.current, swap.RecordedCurrent)
    assert report.current.noise_source == "repeats"
    assert report.current.noise_cases == 100
    assert report.current.noise_floor is not None
    assert report.current.noise_floor.value == pytest.approx(0.75)
    [candidate] = report.candidates
    assert candidate.gap is not None
    assert candidate.gap.difference == pytest.approx(0.25)
    assert candidate.gap.fixed == 25 and candidate.gap.broken == 0
    assert candidate.verdict == "switch"


def test_a_provided_figure_wins_over_repeats() -> None:
    records = recorded_items(20, lambda n: tags(f"t{n}"), lambda n: tags(f"t{n}"))
    floor = swap.Interval(0.5, 0.4, 0.6)

    report, _ = run_recorded({"new": same}, ["new"], records=records, self_agreement=floor)

    assert isinstance(report.current, swap.RecordedCurrent)
    assert report.current.noise_source == "provided"


def test_records_without_the_teachers_answer_are_skipped() -> None:
    records = recorded_items(30, lambda n: tags(f"t{n}") if n % 3 else None, no_repeat)

    report, chats = run_recorded({"new": same}, ["new"], records=records)

    assert isinstance(report.current, swap.RecordedCurrent)
    assert report.current.cases == 20 and report.current.skipped == 10
    assert report.cases == 20
    assert len(chats[LITELLM].calls) == 20


def test_another_teacher_key_can_be_the_current_answer() -> None:
    records = [item.with_outputs({"other": TeacherOutput(output=tags("z"))}) for item in items(20)]

    report, _ = run_recorded({"new": same}, ["new"], records=records, teacher="other")

    assert report.candidates[0].agreement.value == 0.0


def upper_view(texts: Sequence[str]) -> list[str | None]:
    return [None if "drop" in text else text.upper() for text in texts]


def test_the_view_maps_recorded_and_candidate_answers_before_scoring() -> None:
    seen: list[list[str]] = []

    def view(texts: Sequence[str]) -> list[str | None]:
        seen.append(list(texts))
        return upper_view(texts)

    records = recorded_items(20, lambda n: tags(f"T{n}"), no_repeat)

    def mixed(model: str, text: str) -> str:
        return tags("drop") if number(text) < 5 else same(model, text)

    report, _ = run_recorded({"new": mixed}, ["new"], records=records, view=view)

    [candidate] = report.candidates
    assert candidate.agreement.value == pytest.approx(15 / 20)
    assert candidate.usage.unreadable == 5
    assert len(seen) == 2 and len(seen[0]) == 20


def emptiness(reference: str | None) -> str:
    return "unreadable" if reference is None else "empty" if reference == tags() else "found"


def test_agreement_is_split_by_a_stratify_function() -> None:
    records = recorded_items(40, lambda n: tags() if n % 2 else tags(f"t{n}"), no_repeat)

    def answer(model: str, text: str) -> str:
        n = number(text)
        return tags() if n % 2 or n % 4 == 0 else tags(f"t{n}")

    report, _ = run_recorded({"new": answer}, ["new"], records=records, stratify=emptiness)

    strata = {stratum.name: stratum for stratum in report.candidates[0].strata}
    assert set(strata) == {"empty", "found"}
    assert strata["empty"].cases == 20 and strata["empty"].agreement.value == 1.0
    assert strata["found"].cases == 20 and strata["found"].agreement.value == pytest.approx(0.5)
    assert (strata["found"].agreement.low, strata["found"].agreement.high) == pytest.approx(
        clopper_pearson(10, 20)
    )


def test_recorded_mode_rejects_a_cost_ratio_limit_it_cannot_measure() -> None:
    with pytest.raises(ValueError, match="cost"):
        run_recorded({"new": same}, ["new"], max_cost_ratio=1.0)


def test_recorded_mode_keeps_the_litellm_change_and_history(tmp_path: Path) -> None:
    history = History(tmp_path / "history.jsonl")
    config = {
        "model_list": [{"model_name": "tagging", "litellm_params": {"model": "openrouter/x/old"}}]
    }

    report, _ = run_recorded({"new": same}, ["new"], history=history, litellm_config=config)

    assert report.litellm is not None
    assert report.litellm["before"] == {"model": "openrouter/x/old"}
    run_id = report.candidates[0].run_id
    assert run_id is not None
    assert set(history.get(run_id).metrics) == {"agreement"}


def test_recorded_current_parses_from_the_cli_text() -> None:
    assert swap.recorded_teacher("recorded") == "production"
    assert swap.recorded_teacher("recorded:judge") == "judge"
    assert swap.recorded_teacher("old") is None
    assert swap.parse_interval("0.95") == swap.Interval(0.95, 0.95, 0.95)
    assert swap.parse_interval("0.95,0.91,0.98") == swap.Interval(0.95, 0.91, 0.98)


def recorded_cli(tmp_path: Path, *extra: str) -> list[str]:
    records = tmp_path / "records.jsonl"
    DatasetStore(records).add(items(30))
    return [
        "swap",
        str(spec_dir(tmp_path)),
        "--records",
        str(records),
        "--candidate",
        "new",
        "--base-url",
        LITELLM,
        "--history",
        str(tmp_path / "history.jsonl"),
        *extra,
    ]


def test_the_cli_runs_a_recorded_swap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    clock = Clock()
    made: list[FakeChat] = []

    def client(base_url: str, api_key: str, **_: Any) -> FakeChat:
        made.append(FakeChat(same, clock))
        return made[-1]

    monkeypatch.setattr(swap, "ChatClient", client)
    out = tmp_path / "report.json"

    code = main(
        recorded_cli(
            tmp_path,
            "--current",
            "recorded",
            "--view",
            "test_swap:upper_view",
            "--stratify",
            "test_swap:emptiness",
            "--self-agreement",
            "0.9,0.8,0.95",
            "--out",
            str(out),
        )
    )

    assert code == 0
    report = json.loads(out.read_text())
    assert report["current"]["teacher"] == "production"
    assert report["current"]["noise_floor"] == {"value": 0.9, "low": 0.8, "high": 0.95}
    assert report["candidates"][0]["strata"][0]["name"] == "found"
    assert {call[0] for call in made[0].calls} == {"new"}
    printed = capsys.readouterr().out
    assert "noise floor: 0.900 [0.800, 0.950] (provided)" in printed


def test_the_cli_says_when_the_noise_floor_is_not_measured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(swap, "ChatClient", lambda *_, **__: FakeChat(same, Clock()))

    code = main(recorded_cli(tmp_path, "--current", "recorded", "--out", str(tmp_path / "r.json")))

    assert code == 0
    assert "noise floor: not measured" in capsys.readouterr().out


def test_the_cli_keeps_view_and_stratify_for_recorded_mode(tmp_path: Path) -> None:
    code = main(recorded_cli(tmp_path, "--current", "old", "--view", "test_swap:upper_view"))

    assert code == 1
