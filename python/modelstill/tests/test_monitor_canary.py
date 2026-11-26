import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from modelstill.benchmark import Benchmark
from modelstill.client import ChatError, ChatReply
from modelstill.evals import Case, exact_match, run
from modelstill.monitor.alerts import Alert
from modelstill.monitor.canary import (
    MonitorConfig,
    check_canary,
    load_monitor_config,
    resolve,
    run_canary,
    run_drift,
)

BENCH = Benchmark(
    name="canary",
    cases=tuple(Case(f"c{i}", f"question {i}", f"answer {i}") for i in range(10)),
)
NOW = datetime(2026, 11, 23, 12, tzinfo=UTC)
SCHEMA = Path(__file__).resolve().parents[3] / "deploy" / "clickhouse" / "schema.sql"


def schema_columns(table: str) -> list[str]:
    body = SCHEMA.read_text().split(f"CREATE TABLE IF NOT EXISTS {table}")[1].split("ENGINE")[0]
    return re.findall(r"^\s{4}(\w+)\s", body, flags=re.MULTILINE)


class FakeChat:
    def __init__(self, wrong: set[int] | None = None, fail: set[int] | None = None) -> None:
        self.wrong = wrong or set()
        self.fail = fail or set()
        self.calls: list[tuple[str, list[dict[str, str]], dict[str, Any]]] = []

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        self.calls.append((model, messages, params))
        number = int(messages[-1]["content"].split()[-1])
        if number in self.fail:
            raise ChatError("503: down")
        text = "wrong" if number in self.wrong else f"answer {number}"
        return ChatReply(text, model, 3, 2, None, {"model": model})


class Recorder:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}

    def write(self, table: str, rows: list[dict[str, Any]]) -> None:
        self.tables.setdefault(table, []).extend(rows)


class Alerts:
    def __init__(self) -> None:
        self.sent: list[Alert] = []

    def send(self, alert: Alert) -> None:
        self.sent.append(alert)


def write_benchmark(path: Path) -> Path:
    path.write_text(
        "".join(
            json.dumps({"id": c.id, "input": c.input, "expected": c.expected}) + "\n"
            for c in BENCH.cases
        )
    )
    return path


def monitor_config(tmp_path: Path, floor: float = 0.5) -> MonitorConfig:
    return MonitorConfig.model_validate(
        {
            "task": "qa",
            "target": {"base_url": "http://litellm", "model": "qa-alias"},
            "state_dir": str(tmp_path / "state"),
            "params": {"temperature": 0, "max_tokens": 50},
            "canary": {
                "benchmark": str(write_benchmark(tmp_path / "canary.jsonl")),
                "metric": {"ref": "exact_match"},
                "floor": floor,
            },
            "drift": {"prompts": str(tmp_path / "canary.jsonl")},
        }
    )


def test_a_canary_scores_every_item_with_an_exact_interval(tmp_path: Path) -> None:
    config = monitor_config(tmp_path)
    chat, writer = FakeChat(wrong={3}), Recorder()

    outcome = run_canary(config, chat, stores=[writer], alerts=[], clock=lambda: NOW)

    assert outcome.passed == 9 and outcome.total == 10
    assert outcome.low == pytest.approx(0.5549839)
    assert outcome.high == pytest.approx(0.9974714)
    assert chat.calls[0][0] == "qa-alias"
    assert chat.calls[0][2] == {"temperature": 0, "max_tokens": 50}


def test_canary_rows_fill_the_clickhouse_tables(tmp_path: Path) -> None:
    config = monitor_config(tmp_path)
    writer = Recorder()

    run_canary(config, FakeChat(wrong={3}), stores=[writer], alerts=[], clock=lambda: NOW)

    items = writer.tables["modelstill.canary_results"]
    [summary] = writer.tables["modelstill.canary_runs"]
    assert len(items) == 10
    assert sum(1 for row in items if row["pass"]) == 9
    assert {row["ts"] for row in items} == {summary["ts"]}
    assert list(items[0]) == schema_columns("modelstill.canary_results")
    assert list(summary) == schema_columns("modelstill.canary_runs")
    assert summary["passed"] == 9
    assert summary["provider"] == "qa-alias"
    assert summary["low"] == pytest.approx(0.5549839)


def test_a_pass_rate_whose_upper_bound_is_below_the_floor_alerts(tmp_path: Path) -> None:
    config = monitor_config(tmp_path, floor=0.95)
    alerts = Alerts()

    run_canary(
        config, FakeChat(wrong={1, 2, 3, 4, 5}), stores=[], alerts=[alerts], clock=lambda: NOW
    )

    assert [alert.kind for alert in alerts.sent] == ["canary_below_floor"]


def test_a_drop_versus_the_last_run_beyond_noise_alerts(tmp_path: Path) -> None:
    config = monitor_config(tmp_path, floor=0.0)
    alerts = Alerts()
    run_canary(config, FakeChat(), stores=[], alerts=[alerts], clock=lambda: NOW)

    outcome = run_canary(
        config, FakeChat(wrong={0, 1, 2, 3, 4, 5}), stores=[], alerts=[alerts], clock=lambda: NOW
    )

    assert [alert.kind for alert in alerts.sent] == ["canary_regression"]
    assert outcome.comparison is not None and outcome.comparison.verdict == "worse"


def test_a_one_item_change_is_noise_and_does_not_alert(tmp_path: Path) -> None:
    config = monitor_config(tmp_path, floor=0.0)
    alerts = Alerts()
    run_canary(config, FakeChat(), stores=[], alerts=[alerts], clock=lambda: NOW)

    run_canary(config, FakeChat(wrong={4}), stores=[], alerts=[alerts], clock=lambda: NOW)

    assert alerts.sent == []


def test_check_canary_without_history_only_checks_the_floor() -> None:
    perfect = run(BENCH.cases, lambda q: q.replace("question", "answer"), exact_match)

    assert check_canary("qa", "qa-alias", perfect, previous=None, floor=0.5) == ([], None)


def test_drift_is_quiet_on_the_first_run_and_on_identical_answers(tmp_path: Path) -> None:
    config = monitor_config(tmp_path)
    alerts = Alerts()

    first = run_drift(config, FakeChat(), alerts=[alerts], clock=lambda: NOW)
    second = run_drift(config, FakeChat(), alerts=[alerts], clock=lambda: NOW)

    assert first.previous is None
    assert second.changed == [] and second.fingerprint == first.fingerprint
    assert alerts.sent == []


def test_any_changed_answer_is_provider_drift(tmp_path: Path) -> None:
    config = monitor_config(tmp_path)
    alerts = Alerts()
    run_drift(config, FakeChat(), alerts=[alerts], clock=lambda: NOW)

    result = run_drift(config, FakeChat(wrong={7}), alerts=[alerts], clock=lambda: NOW)

    assert result.changed == ["c7"]
    assert [alert.kind for alert in alerts.sent] == ["provider_drift"]


def test_drift_ignores_items_that_failed_instead_of_calling_them_changed(tmp_path: Path) -> None:
    config = monitor_config(tmp_path)
    alerts = Alerts()
    run_drift(config, FakeChat(), alerts=[alerts], clock=lambda: NOW)

    result = run_drift(config, FakeChat(fail={2}), alerts=[alerts], clock=lambda: NOW)

    assert result.failed == ["c2"]
    assert result.changed == []
    assert alerts.sent == []


def test_drift_always_runs_at_temperature_zero(tmp_path: Path) -> None:
    config = monitor_config(tmp_path).model_copy(update={"params": {"temperature": 0.7}})
    chat = FakeChat()

    run_drift(config, chat, alerts=[], clock=lambda: NOW)

    assert {call[2]["temperature"] for call in chat.calls} == {0}


def test_plugins_resolve_builtins_and_import_paths_with_arguments() -> None:
    metric = resolve({"ref": "exact_match"}, kind="metric")
    factory = resolve(
        {"ref": "modelstill.evals:Case", "args": {"id": "x", "input": 1, "expected": 2}},
        kind="metric",
    )

    assert metric("a", "a") == 1.0
    assert factory == Case("x", 1, 2)


def test_config_paths_are_relative_to_the_config_file(tmp_path: Path) -> None:
    path = tmp_path / "monitor.yaml"
    path.write_text(
        json.dumps(
            {
                "task": "qa",
                "target": {"base_url": "http://x", "model": "m"},
                "state_dir": "state",
                "canary": {"benchmark": "canary.jsonl", "floor": 0.5},
            }
        )
    )

    config = load_monitor_config(path)

    assert config.state_dir == tmp_path / "state"
    assert config.canary is not None and config.canary.benchmark == tmp_path / "canary.jsonl"
