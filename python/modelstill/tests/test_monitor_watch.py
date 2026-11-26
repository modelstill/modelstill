import json
import random
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml

from modelstill.client import ChatError, ChatReply
from modelstill.monitor.alerts import Alert
from modelstill.monitor.canary import MonitorConfig, load_monitor_config
from modelstill.monitor.watch import check_watch, record_baseline, token_distance

NOW = datetime(2026, 11, 24, 9, tzinfo=UTC)
SCHEMA = Path(__file__).resolve().parents[3] / "deploy" / "clickhouse" / "schema.sql"


def schema_columns(table: str) -> list[str]:
    body = SCHEMA.read_text().split(f"CREATE TABLE IF NOT EXISTS {table}")[1].split("ENGINE")[0]
    return re.findall(r"^\s{4}(\w+)\s", body, flags=re.MULTILINE)


class LogprobChat:
    def __init__(
        self,
        shift: float = 0.0,
        noise: float = 0.0,
        wrong: set[int] | None = None,
        text: str | None = None,
        model: str = "qa-model-v1",
        logprobs: bool = True,
        fail: set[int] | None = None,
        seed: int = 0,
    ) -> None:
        self.shift = shift
        self.noise = noise
        self.wrong = wrong or set()
        self.text = text
        self.model = model
        self.logprobs = logprobs
        self.fail = fail or set()
        self.rng = random.Random(seed)
        self.calls: list[dict[str, Any]] = []

    def _tokens(self, number: int, text: str) -> list[dict[str, Any]]:
        tokens = []
        for index, word in enumerate(text.split()):
            value = -(0.1 + 0.05 * ((number + index) % 7)) - self.shift
            value += self.noise * self.rng.gauss(0, 1)
            alternative = value - 1.5
            tokens.append(
                {
                    "token": word,
                    "logprob": value,
                    "top_logprobs": [
                        {"token": word, "logprob": value},
                        {"token": f"alt{index}", "logprob": alternative},
                    ],
                }
            )
        return tokens

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        self.calls.append({"model": model, **params})
        number = int(messages[-1]["content"].split()[-1])
        if number in self.fail:
            raise ChatError("503: down")
        text = self.text or ("wrong" if number in self.wrong else f"answer {number}")
        choice: dict[str, Any] = {"message": {"content": text}}
        if self.logprobs and params.get("logprobs"):
            choice["logprobs"] = {"content": self._tokens(number, text)}
        return ChatReply(text, self.model, 3, 2, None, {"model": self.model, "choices": [choice]})


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
            json.dumps({"id": f"c{i}", "input": f"question {i}", "expected": f"answer {i}"}) + "\n"
            for i in range(10)
        )
    )
    return path


def watch_config(tmp_path: Path, **watch: Any) -> MonitorConfig:
    benchmark = write_benchmark(tmp_path / "canary.jsonl")
    return MonitorConfig.model_validate(
        {
            "task": "qa",
            "target": {"base_url": "http://litellm", "model": "qa-alias"},
            "state_dir": str(tmp_path / "state"),
            "params": {"temperature": 0.7, "max_tokens": 50},
            "canary": {"benchmark": str(benchmark), "floor": 0.5},
            "watch": {"prompts": str(benchmark), **watch},
        }
    )


def baseline_then_check(
    tmp_path: Path,
    before: LogprobChat,
    after: LogprobChat,
    fallback: Path | None = None,
    **watch: Any,
) -> tuple[Any, Recorder, Alerts]:
    config = watch_config(tmp_path, **watch)
    record_baseline(config, before, clock=lambda: NOW)
    stores, alerts = Recorder(), Alerts()
    outcome = check_watch(config, after, [stores], [alerts], clock=lambda: NOW, fallback=fallback)
    return outcome, stores, alerts


def test_the_baseline_asks_for_logprobs_at_temperature_0_and_samples_each_prompt_twice(
    tmp_path: Path,
) -> None:
    config = watch_config(tmp_path, top_logprobs=3, max_tokens=8)
    chat = LogprobChat()

    baseline = record_baseline(config, chat, clock=lambda: NOW)

    stored = json.loads(baseline.path.read_text())
    prompt_calls = [call for call in chat.calls if call.get("logprobs")]
    assert len(prompt_calls) == 20
    assert prompt_calls[0] == {
        "model": "qa-alias",
        "temperature": 0,
        "max_tokens": 8,
        "logprobs": True,
        "top_logprobs": 3,
    }
    assert stored["canary"]["result"]["mean"] == 1.0
    [first, second] = stored["prompts"]["c4"]
    assert first["hash"] == second["hash"]
    assert first["model"] == "qa-model-v1"
    assert first["tokens"][0] == {
        "token": "answer",
        "logprob": pytest.approx(-0.3),
        "top": {"answer": pytest.approx(-0.3), "alt0": pytest.approx(-1.8)},
    }
    assert baseline.summary["prompts"] == 10


def test_a_baseline_is_not_replaced_unless_asked(tmp_path: Path) -> None:
    config = watch_config(tmp_path)
    record_baseline(config, LogprobChat(), clock=lambda: NOW)

    with pytest.raises(FileExistsError, match="--replace"):
        record_baseline(config, LogprobChat(), clock=lambda: NOW)
    replaced = record_baseline(config, LogprobChat(), clock=lambda: NOW, replace=True)

    assert replaced.path.exists()


def test_top_logprobs_0_asks_only_for_the_chosen_tokens(tmp_path: Path) -> None:
    config = watch_config(tmp_path, top_logprobs=0)
    chat = LogprobChat()

    record_baseline(config, chat, clock=lambda: NOW)

    assert "top_logprobs" not in chat.calls[-1]


def test_checking_without_a_baseline_says_how_to_record_one(tmp_path: Path) -> None:
    config = watch_config(tmp_path)

    with pytest.raises(FileNotFoundError, match="watch baseline"):
        check_watch(config, LogprobChat(), [], [], clock=lambda: NOW)


def test_an_unchanged_endpoint_raises_nothing(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(tmp_path, LogprobChat(), LogprobChat())

    assert outcome.level == "ok"
    assert alerts.sent == []
    assert outcome.summary["logprob_shift"] == 0.0
    assert outcome.summary["logprob_p"] == 1.0
    assert outcome.summary["canary_passed"] == 10
    assert outcome.summary["answers_changed"] == 0


def test_provider_noise_alone_does_not_alert(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(noise=0.05, seed=1), LogprobChat(noise=0.05, seed=2)
    )

    assert outcome.summary["logprob_noise"] > 0
    assert outcome.summary["logprob_p"] > 0.01
    assert alerts.sent == []


def test_a_small_logprob_shift_with_the_same_answers_is_a_warning(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(tmp_path, LogprobChat(), LogprobChat(shift=0.05))

    assert outcome.level == "warn"
    assert [alert.kind for alert in alerts.sent] == ["watch_logprob_shift"]
    assert alerts.sent[0].level == "warn"
    assert outcome.summary["logprob_p"] == pytest.approx(1 / 1024)
    assert outcome.summary["logprob_excess"] == pytest.approx(0.05)
    assert outcome.summary["logprob_excess_low"] == pytest.approx(0.05)
    assert outcome.summary["logprob_excess_high"] == pytest.approx(0.05)
    assert outcome.summary["answers_changed"] == 0


def test_a_large_logprob_shift_above_provider_noise_is_critical(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(
        tmp_path,
        LogprobChat(noise=0.02, seed=1),
        LogprobChat(noise=0.02, shift=0.6, seed=2),
        critical_shift=0.25,
    )

    assert outcome.level == "critical"
    assert alerts.sent[0].level == "critical"
    assert outcome.summary["logprob_excess"] > 0.25


def test_a_canary_regression_is_critical_and_uses_the_exact_paired_test(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(), LogprobChat(wrong={0, 1, 2, 3, 4, 5, 6})
    )

    kinds = {alert.kind: alert for alert in alerts.sent}
    assert outcome.level == "critical"
    assert kinds["watch_canary_regression"].level == "critical"
    assert outcome.summary["canary_passed"] == 3
    assert outcome.summary["canary_baseline_passed"] == 10
    assert outcome.summary["canary_mcnemar_p"] == pytest.approx(1 / 128)
    assert outcome.summary["canary_low"] == pytest.approx(0.0667395, abs=1e-6)
    assert outcome.summary["canary_difference"] == pytest.approx(-0.7)


def test_canary_below_the_floor_is_critical(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(), LogprobChat(wrong=set(range(9)))
    )

    assert "watch_canary_below_floor" in {alert.kind for alert in alerts.sent}
    assert outcome.level == "critical"


def test_changed_answers_on_prompts_that_were_stable_are_a_warning(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(tmp_path, LogprobChat(), LogprobChat(text="answer 99"))

    kinds = {alert.kind: alert for alert in alerts.sent}
    assert outcome.summary["answers_changed"] == 10
    assert kinds["watch_answers_changed"].level == "warn"


def test_a_few_changed_answers_are_only_info(tmp_path: Path) -> None:
    class OneDifferent(LogprobChat):
        def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
            if messages[-1]["content"].endswith(" 7") and params.get("logprobs"):
                self.text = "something else"
            reply = super().chat(model, messages, **params)
            self.text = None
            return reply

    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(), OneDifferent(), max_changed=0.2
    )

    assert outcome.summary["answers_changed"] == 1
    assert [(alert.kind, alert.level) for alert in alerts.sent] == [
        ("watch_answers_changed", "info")
    ]
    assert outcome.level == "info"


def test_a_new_served_model_name_is_a_warning(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(), LogprobChat(model="qa-model-v2")
    )

    kinds = {alert.kind: alert for alert in alerts.sent}
    assert kinds["watch_served_model_changed"].level == "warn"
    assert kinds["watch_served_model_changed"].details["models"] == {"qa-model-v2": 10}


def test_a_provider_without_logprobs_still_compares_answers(tmp_path: Path) -> None:
    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(logprobs=False), LogprobChat(logprobs=False, text="other")
    )

    assert outcome.summary["logprob_prompts"] == 0
    assert outcome.summary["logprob_p"] is None
    assert outcome.summary["answers_changed"] == 10


def test_failed_calls_are_listed_and_not_counted_as_changes(tmp_path: Path) -> None:
    outcome, _, _ = baseline_then_check(tmp_path, LogprobChat(), LogprobChat(fail={2}))

    assert outcome.failed == ["c2"]
    assert outcome.summary["answers_changed"] == 0
    assert outcome.summary["logprob_prompts"] == 9


def test_critical_with_a_fallback_switches_the_deployment_off(tmp_path: Path) -> None:
    deployment = tmp_path / "qa.deployment.yaml"
    deployment.write_text(
        yaml.safe_dump(
            {
                "task": "qa",
                "mode": "serve",
                "student_model": "s",
                "threshold": 0.9,
                "shadow_sample": 0.1,
            }
        )
    )

    outcome, _, alerts = baseline_then_check(
        tmp_path, LogprobChat(), LogprobChat(wrong=set(range(9))), fallback=deployment
    )

    assert outcome.fallback is True
    assert yaml.safe_load(deployment.read_text())["mode"] == "off"
    assert alerts.sent[-1].kind == "watch_fallback"


def test_a_warning_leaves_the_deployment_alone(tmp_path: Path) -> None:
    deployment = tmp_path / "qa.deployment.yaml"
    deployment.write_text(
        yaml.safe_dump(
            {
                "task": "qa",
                "mode": "serve",
                "student_model": "s",
                "threshold": 0.9,
                "shadow_sample": 0.1,
            }
        )
    )

    outcome, _, _ = baseline_then_check(
        tmp_path, LogprobChat(), LogprobChat(shift=0.05), fallback=deployment
    )

    assert outcome.fallback is False
    assert yaml.safe_load(deployment.read_text())["mode"] == "serve"


def test_the_run_row_fills_the_watch_runs_table(tmp_path: Path) -> None:
    outcome, stores, _ = baseline_then_check(tmp_path, LogprobChat(), LogprobChat(shift=0.05))

    [row] = stores.tables["modelstill.watch_runs"]
    assert list(row) == schema_columns("modelstill.watch_runs")
    assert row == outcome.summary
    assert row["alerts"] == ["watch_logprob_shift"]
    assert row["level"] == "warn"
    history = (tmp_path / "state" / "watch-checks.jsonl").read_text().splitlines()
    assert json.loads(history[0])["prompts"]["c0"]["shift"] == pytest.approx(0.05)


def test_a_changed_prompt_set_needs_a_new_baseline(tmp_path: Path) -> None:
    config = watch_config(tmp_path)
    record_baseline(config, LogprobChat(), clock=lambda: NOW)
    assert config.watch is not None
    config.watch.prompts.write_text(json.dumps({"id": "x", "input": "question 1"}) + "\n")

    with pytest.raises(ValueError, match="new baseline"):
        check_watch(config, LogprobChat(), [], [], clock=lambda: NOW)


def test_token_distance_stops_after_the_first_different_token() -> None:
    def token(text: str, logprob: float, **top: float) -> dict[str, Any]:
        return {"token": text, "logprob": logprob, "top": {text: logprob, **top}}

    before = [token("a", -0.1, b=-2.0), token("x", -0.5), token("y", -0.2)]
    after = [token("a", -0.2, b=-2.4), token("z", -0.4, x=-0.9), token("y", -5.0)]

    assert token_distance(before, after) == pytest.approx((0.1 + 0.4 + 0.4) / 3)
    assert token_distance([], after) is None


def test_a_watch_section_resolves_its_prompts_next_to_the_config(tmp_path: Path) -> None:
    path = tmp_path / "watch.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "task": "qa",
                "target": {"base_url": "http://litellm", "model": "qa-alias"},
                "state_dir": "state",
                "watch": {"prompts": "prompts.jsonl"},
            }
        )
    )

    config = load_monitor_config(path)

    assert config.watch is not None
    assert config.watch.prompts == tmp_path / "prompts.jsonl"
    assert config.watch.repeats == 2
    assert config.watch.top_logprobs == 5
