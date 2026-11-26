import email.message
import hashlib
import io
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest

from modelstill import push
from modelstill.benchmark import Benchmark, History
from modelstill.cli import main
from modelstill.data import DatasetItem, Provenance, TeacherOutput
from modelstill.evals import Case, micro_f1, run, set_f1
from modelstill.ingest.runs import ImportedCase, ImportedRun, record_run
from modelstill.push import PushClient, PushError, review_items, run_payload, task_payload

TASK_SPEC = Path(__file__).resolve().parent / "fixtures" / "tasks" / "technographics" / "spec.yaml"

CASES = tuple(Case(f"case-{i:03d}", i, ["a"] if i % 2 else []) for i in range(40))
BENCH = Benchmark(name="tech_gold", cases=CASES)


class Recorder:
    def __init__(self, reply: dict[str, Any] | None = None, status: int = 200) -> None:
        self.reply = reply if reply is not None else {}
        self.status = status
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        if self.status >= 400:
            raise urllib.error.HTTPError(
                request.full_url,
                self.status,
                "error",
                email.message.Message(),
                io.BytesIO(b'{"error": "unauthorized"}'),
            )
        return io.BytesIO(json.dumps(self.reply).encode())

    def bodies(self) -> list[dict[str, Any]]:
        bodies: list[dict[str, Any]] = []
        for request in self.requests:
            assert isinstance(request.data, bytes)
            bodies.append(json.loads(request.data))
        return bodies


def history_with_runs(path: Path) -> tuple[str, str]:
    history = History(path)
    weak = run(CASES, model=lambda i: [], metric=set_f1)
    strong = run(CASES, model=lambda i: ["a"] if i % 2 else [], metric=set_f1)
    first = history.record(BENCH, "technographics", weak)
    second = history.record(
        BENCH, "technographics", strong, metrics={"pooled_f1": micro_f1(CASES, strong)}
    )
    return first, second


def test_sends_json_with_the_bearer_token() -> None:
    recorder = Recorder({"ok": True})
    client = PushClient("http://api.test/", token="secret", opener=recorder)

    assert client.send("PUT", "/v1/tasks/t", {"a": 1}) == {"ok": True}

    request = recorder.requests[0]
    assert request.full_url == "http://api.test/v1/tasks/t"
    assert request.get_method() == "PUT"
    assert request.get_header("Authorization") == "Bearer secret"
    assert request.get_header("Content-type") == "application/json"
    assert recorder.bodies() == [{"a": 1}]


def test_reports_http_errors_with_status_and_body() -> None:
    client = PushClient("http://api.test", token="bad", opener=Recorder(status=401))

    with pytest.raises(PushError, match=r"401.*unauthorized"):
        client.send("PUT", "/v1/tasks/t", {})


def test_task_payload_carries_version_snapshot_hash_and_spec() -> None:
    payload = task_payload(TASK_SPEC, git_sha="abc1234")

    assert payload["version"] == 1
    assert payload["gitSha"] == "abc1234"
    assert len(payload["snapshotHash"]) == 64
    assert payload["spec"]["task"] == "technographics"


def test_run_payload_uses_the_primary_metric_and_every_case(tmp_path: Path) -> None:
    _, second = history_with_runs(tmp_path / "runs.jsonl")
    entry = History(tmp_path / "runs.jsonl").get(second)

    payload = run_payload(entry, primary_metric="pooled_f1", split="gold")

    assert payload["id"] == entry.id
    assert payload["createdAt"] == entry.created_at
    assert payload["model"] == "technographics"
    assert payload["benchmark"] == {"name": "tech_gold", "version": BENCH.version}
    assert payload["primaryMetric"] == "pooled_f1"
    assert payload["metrics"]["pooled_f1"]["value"] == entry.metrics["pooled_f1"].value
    assert len(payload["cases"]) == 40
    assert payload["cases"][1] == {
        "inputHash": "case-001",
        "score": 1.0,
        "output": ["a"],
        "input": 1,
        "expected": ["a"],
    }


def test_a_run_without_the_primary_metric_falls_back_to_the_per_case_mean(
    tmp_path: Path,
) -> None:
    first, _ = history_with_runs(tmp_path / "runs.jsonl")
    entry = History(tmp_path / "runs.jsonl").get(first)

    payload = run_payload(entry, primary_metric="pooled_f1", split="gold")

    assert payload["primaryMetric"] is None
    assert payload["metrics"] == {}


def test_review_items_fill_in_hashes_agreement_and_review_state(tmp_path: Path) -> None:
    path = tmp_path / "dataset.jsonl"
    rows = [
        {"input": {"posting": "Kafka"}, "teacher_outputs": {"a": ["kafka"], "b": ["kafka"]}},
        {"input": {"posting": "dbt"}, "teacher_outputs": {"a": ["dbt"], "b": []}},
        {"input_hash": "h3", "input": "x", "teacher_outputs": {}, "review_state": "accepted"},
    ]
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")

    items = review_items(path)

    expected_hash = hashlib.sha256(b'{"posting":"Kafka"}').hexdigest()
    assert items[0] == {
        "inputHash": expected_hash,
        "input": {"posting": "Kafka"},
        "teacherOutputs": {"a": ["kafka"], "b": ["kafka"]},
        "agreement": True,
        "reviewState": "none",
    }
    assert items[1]["agreement"] is False
    assert items[1]["reviewState"] == "queued"
    assert items[2]["inputHash"] == "h3"
    assert items[2]["reviewState"] == "accepted"


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder({"run": {"mean": 0.9, "low": 0.8, "high": 0.95, "cases": 40}})
    monkeypatch.setattr(push, "_default_opener", recorder)
    monkeypatch.setenv("MODELSTILL_API_URL", "http://api.test")
    monkeypatch.setenv("MODELSTILL_API_TOKEN", "secret")
    return recorder


def test_cli_pushes_a_task_under_another_slug(
    recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    recorder.reply = {"task": {"slug": "technographics-real", "version": 1}}

    code = main(["push", "task", str(TASK_SPEC), "--task", "technographics-real", "--git-sha", "x"])

    assert code == 0
    assert recorder.requests[0].full_url == "http://api.test/v1/tasks/technographics-real"
    assert recorder.requests[0].get_method() == "PUT"
    assert "technographics-real" in capsys.readouterr().out


def test_cli_pushes_a_run_by_id_prefix(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    _, second = history_with_runs(path)
    args = ["push", "run", str(path), second[:8], "--task", "t", "--primary-metric", "pooled_f1"]

    assert main(args) == 0

    request = recorder.requests[0]
    assert request.full_url == "http://api.test/v1/tasks/t/eval-runs"
    assert request.get_method() == "POST"
    body = recorder.bodies()[0]
    assert body["id"] == second
    assert body["split"] == "gold"
    assert body["primaryMetric"] == "pooled_f1"
    assert second[:8] in capsys.readouterr().out


def test_cli_push_needs_a_token(
    tmp_path: Path,
    recorder: Recorder,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("MODELSTILL_API_TOKEN")

    assert main(["push", "task", str(TASK_SPEC)]) == 1
    assert "MODELSTILL_API_TOKEN" in capsys.readouterr().err
    assert recorder.requests == []


def test_cli_api_flag_overrides_the_environment(recorder: Recorder) -> None:
    recorder.reply = {"task": {"slug": "technographics", "version": 1}}

    main(["push", "task", str(TASK_SPEC), "--api", "http://other.test", "--git-sha", "x"])

    assert recorder.requests[0].full_url == "http://other.test/v1/tasks/technographics"


def test_cli_reports_api_errors(recorder: Recorder, capsys: pytest.CaptureFixture[str]) -> None:
    recorder.status = 401

    assert main(["push", "task", str(TASK_SPEC), "--git-sha", "x"]) == 1
    assert "401" in capsys.readouterr().err


def test_cli_pushes_a_gate_decided_on_the_primary_metric(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with_runs(path)
    recorder.reply = {"gate": {"passed": False}}
    args = [
        "push", "gate", str(path), second[:8], "--task", "t", "--spec", str(TASK_SPEC),
        "--primary-metric", "pooled_f1", "--previous", first[:8],
        "--flip-rate", "0.0", "--cost-ratio", "0.1", "--p95-latency-ms", "900",
    ]  # fmt: skip

    assert main(args) == 0

    assert recorder.requests[0].full_url == "http://api.test/v1/tasks/t/gates"
    body = recorder.bodies()[0]
    pooled = History(path).get(second).metrics["pooled_f1"]
    assert body["evalRunId"] == second
    assert body["previousEvalRunId"] == first
    assert body["report"]["measurements"]["metric_low"] == pooled.low
    assert body["passed"] == all(check["passed"] for check in body["checks"])
    assert body["report"]["primaryMetric"] == "pooled_f1"
    assert body["report"]["measurements"]["metric_low"] == pooled.low

    main(args)
    assert recorder.bodies()[1]["id"] == body["id"]
    assert "gate" in capsys.readouterr().out


def test_cli_pushes_review_items_in_batches(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "dataset.jsonl"
    rows = [{"input": {"i": i}, "teacher_outputs": {"a": [i], "b": []}} for i in range(1200)]
    path.write_text("\n".join(json.dumps(row) for row in rows))
    recorder.reply = {"upserted": 500}

    assert main(["push", "review", str(path), "--task", "t"]) == 0

    assert [len(body["items"]) for body in recorder.bodies()] == [500, 500, 200]
    assert recorder.requests[0].full_url == "http://api.test/v1/tasks/t/review-items"
    assert "1200" in capsys.readouterr().out


def test_gate_checks_the_regression_against_the_previous_run(
    tmp_path: Path, recorder: Recorder
) -> None:
    path = tmp_path / "runs.jsonl"
    first, second = history_with_runs(path)
    recorder.reply = {"gate": {"passed": False}}
    args = [
        "push", "gate", str(path), second[:8], "--task", "t", "--spec", str(TASK_SPEC),
        "--previous", first[:8],
        "--flip-rate", "0.0", "--cost-ratio", "0.1", "--p95-latency-ms", "900",
    ]  # fmt: skip

    assert main(args) == 0

    checks = {check["name"] for check in recorder.bodies()[0]["checks"]}
    assert "regression_vs_baseline" in checks


def test_a_relative_gate_without_a_previous_run_is_an_error(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    _, second = history_with_runs(path)
    args = [
        "push", "gate", str(path), second[:8], "--task", "t", "--spec", str(TASK_SPEC),
        "--flip-rate", "0.0", "--cost-ratio", "0.1", "--p95-latency-ms", "900",
    ]  # fmt: skip

    assert main(args) == 1
    assert "--previous" in capsys.readouterr().err
    assert recorder.requests == []


def test_review_items_read_a_dataset_store_file(tmp_path: Path) -> None:
    item = DatasetItem.create(
        {"title": "Data Engineer"},
        Provenance("fixture", {"id": "p1"}, "test-1"),
        {"production": TeacherOutput(output="A"), "second": TeacherOutput(error="timeout")},
    ).with_review("queued")
    path = tmp_path / "data.jsonl"
    path.write_text(json.dumps(item.to_json()) + "\n")

    [pushed] = push.review_items(path)

    assert pushed["inputHash"] == item.input_hash
    assert pushed["teacherOutputs"] == {"production": "A"}
    assert pushed["reviewState"] == "queued"


def test_review_items_keep_the_latest_record_of_an_item(tmp_path: Path) -> None:
    first = DatasetItem.create(
        {"title": "Data Engineer"},
        Provenance("fixture", {"id": "p1"}, "test-1"),
        {"production": TeacherOutput(output="A")},
    )
    later = first.with_outputs({"second": TeacherOutput(output="B")}).with_review("queued")
    path = tmp_path / "data.jsonl"
    path.write_text(json.dumps(first.to_json()) + "\n" + json.dumps(later.to_json()) + "\n")

    pushed = push.review_items(path)

    assert len(pushed) == 1
    assert pushed[0]["teacherOutputs"] == {"production": "A", "second": "B"}


def test_run_payload_sends_each_case_input_expected_and_metrics(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    imported = ImportedRun(
        "student",
        "test",
        (
            ImportedCase("a", {"posting": "Kafka"}, ["kafka"], 1.0, ["kafka"], metrics={"f1": 1.0}),
            ImportedCase("b", {"posting": "dbt"}, ["dbt"], 0.0, []),
        ),
    )
    entry = record_run(History(path), "tech", imported).entry

    cases = run_payload(History(path).get(entry.id), None, "gold")["cases"]

    assert cases[0] == {
        "inputHash": "a",
        "score": 1.0,
        "output": ["kafka"],
        "input": {"posting": "Kafka"},
        "expected": ["kafka"],
        "metrics": {"f1": 1.0},
    }
    assert cases[1] == {
        "inputHash": "b",
        "score": 0.0,
        "output": [],
        "input": {"posting": "dbt"},
        "expected": ["dbt"],
    }


def test_run_payload_without_content_sends_only_hashes_and_scores(tmp_path: Path) -> None:
    path = tmp_path / "runs.jsonl"
    imported = ImportedRun(
        "student", "test", (ImportedCase("a", "secret", ["x"], 1.0, ["x"], metrics={"f1": 1.0}),)
    )
    entry = record_run(History(path), "tech", imported).entry

    [case] = run_payload(entry, None, "gold", content=False)["cases"]

    assert case == {"inputHash": "a", "score": 1.0, "metrics": {"f1": 1.0}}


def test_cli_push_run_no_content_leaves_out_inputs_and_outputs(
    tmp_path: Path, recorder: Recorder
) -> None:
    path = tmp_path / "runs.jsonl"
    _, second = history_with_runs(path)

    assert main(["push", "run", str(path), second[:8], "--task", "t", "--no-content"]) == 0

    cases = recorder.bodies()[0]["cases"]
    assert all(set(case) == {"inputHash", "score"} for case in cases)


def test_cli_push_run_sends_content_by_default(tmp_path: Path, recorder: Recorder) -> None:
    path = tmp_path / "runs.jsonl"
    _, second = history_with_runs(path)

    assert main(["push", "run", str(path), second[:8], "--task", "t"]) == 0

    case = recorder.bodies()[0]["cases"][1]
    assert case == {
        "inputHash": "case-001",
        "score": 1.0,
        "output": ["a"],
        "input": 1,
        "expected": ["a"],
    }


def push_gate(path: Path, *measured: str, extra: tuple[str, ...] = ()) -> int:
    history = History(path)
    first, second = history.runs()[0].id, history.runs()[1].id
    target = ["push", "gate", str(path), second[:8], "--task", "t", "--spec", str(TASK_SPEC)]
    return main([*target, "--previous", first[:8], *measured, *extra])


WORST_CASE = ("--flip-rate", "1", "--cost-ratio", "9", "--p95-latency-ms", "99999")
MEASURED = ("--flip-rate", "0", "--cost-ratio", "0.1", "--p95-latency-ms", "900")


def test_push_gate_reports_checks_at_their_worst_case_as_not_measured(
    tmp_path: Path, recorder: Recorder
) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)
    recorder.reply = {"gate": {"passed": False}}

    assert push_gate(path, *WORST_CASE) == 2

    reported = recorder.bodies()[0]["report"]["notMeasured"]
    assert set(reported) == {"flip_rate", "cost_ratio", "p95_latency_ms"}
    assert all(isinstance(reason, str) and reason for reason in reported.values())


def test_push_gate_sends_a_given_not_measured_reason(tmp_path: Path, recorder: Recorder) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)
    recorder.reply = {"gate": {"passed": False}}
    measured = ("--flip-rate", "0", "--cost-ratio", "9", "--p95-latency-ms", "900")
    reason = ("--not-measured", "cost_ratio=the bill was not exported")

    assert push_gate(path, *measured, extra=reason) == 2

    report = recorder.bodies()[0]["report"]
    assert report["notMeasured"] == {"cost_ratio": "the bill was not exported"}


def test_push_gate_with_every_check_measured_sends_no_not_measured(
    tmp_path: Path, recorder: Recorder
) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)
    recorder.reply = {"gate": {"passed": False}}

    assert push_gate(path, *MEASURED) == 0

    assert "notMeasured" not in recorder.bodies()[0]["report"]


def test_push_gate_refuses_a_not_measured_check_that_passed(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)

    assert push_gate(path, *MEASURED, extra=("--not-measured", "cost_ratio=no bill")) == 1

    assert "cost_ratio" in capsys.readouterr().err
    assert recorder.requests == []


def test_push_gate_refuses_an_unknown_not_measured_check(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)

    assert push_gate(path, *WORST_CASE, extra=("--not-measured", "speed")) == 1

    assert "speed" in capsys.readouterr().err
    assert recorder.requests == []


def test_push_gate_exits_2_when_the_recorded_gate_failed(
    tmp_path: Path, recorder: Recorder, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)
    recorder.reply = {"gate": {"passed": False}}

    assert push_gate(path, *WORST_CASE) == 2

    assert recorder.bodies()[0]["passed"] is False
    assert "failed" in capsys.readouterr().out


def test_push_gate_exits_with_the_decision_it_recorded(tmp_path: Path, recorder: Recorder) -> None:
    path = tmp_path / "runs.jsonl"
    history_with_runs(path)
    recorder.reply = {"gate": {"passed": True}}

    code = push_gate(path, *MEASURED)

    assert code == (0 if recorder.bodies()[0]["passed"] else 2)
