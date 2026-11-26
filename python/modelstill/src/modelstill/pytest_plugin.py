from collections import Counter
from collections.abc import Generator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from modelstill.benchmark import History, load_benchmark
from modelstill.evals import Case
from modelstill.ingest.runs import (
    ImportedCase,
    ImportedRun,
    RecordedRun,
    gate_run,
    load_gate,
    record_run,
    report_lines,
    run_line,
)

SOURCE = "pytest"


@dataclass
class Score:
    value: float | None = None
    output: Any = None
    metrics: dict[str, float] = field(default_factory=dict)

    def record(self, value: float, output: Any = None, **metrics: float) -> None:
        self.value = float(value)
        self.output = output
        self.metrics.update({name: float(number) for name, number in metrics.items()})


SCORE = pytest.StashKey[Score]()


@dataclass(frozen=True)
class Outcome:
    name: str
    nodeid: str
    case: Case | None
    score: float
    output: Any
    error: str | None
    metrics: dict[str, float]
    latency_ms: float


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("modelstill", "record eval cases as a ModelStill run")
    group.addoption("--modelstill-history", help="history JSONL to record the session's run in")
    group.addoption("--modelstill-task", help="benchmark name (default: the rootdir name)")
    group.addoption("--modelstill-model", default=SOURCE, help="model name to record")
    group.addoption("--modelstill-gate", help="task spec or gate YAML; a failed gate fails")
    group.addoption("--modelstill-flip-rate", type=float)
    group.addoption("--modelstill-cost-ratio", type=float)
    group.addoption("--modelstill-p95-latency-ms", type=int, help="default: measured per test")
    group.addoption("--modelstill-primary-metric")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "modelstill: record this test as a ModelStill case")
    config.addinivalue_line(
        "markers", "modelstill_cases(path, argname='case'): one test per case of a benchmark"
    )
    if not config.getoption("modelstill_history"):
        return
    if config.getoption("modelstill_gate") and (
        config.getoption("modelstill_flip_rate") is None
        or config.getoption("modelstill_cost_ratio") is None
    ):
        raise pytest.UsageError(
            "--modelstill-gate needs --modelstill-flip-rate and --modelstill-cost-ratio: "
            "the tests do not measure them"
        )
    config.pluginmanager.register(Recorder(config), "modelstill-recorder")


def _benchmark_path(metafunc: pytest.Metafunc, name: str) -> Path:
    path = Path(name)
    if path.is_absolute():
        return path
    beside = metafunc.definition.path.parent / path
    return beside if beside.exists() else metafunc.config.rootpath / path


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    marker = metafunc.definition.get_closest_marker("modelstill_cases")
    if marker is None:
        return
    argname = marker.kwargs.get("argname", "case")
    if argname not in metafunc.fixturenames:
        return
    cases = load_benchmark(_benchmark_path(metafunc, marker.args[0])).cases
    metafunc.parametrize(argname, cases, ids=[case.id for case in cases])


@pytest.fixture
def modelstill_score(request: pytest.FixtureRequest) -> Score:
    score = Score()
    request.node.stash[SCORE] = score
    return score


def _is_case(item: pytest.Item) -> bool:
    return (
        item.get_closest_marker("modelstill") is not None
        or item.get_closest_marker("modelstill_cases") is not None
        or SCORE in item.stash
    )


def _case(item: pytest.Item) -> Case | None:
    params = getattr(getattr(item, "callspec", None), "params", {})
    return next((value for value in params.values() if isinstance(value, Case)), None)


def _error(call: pytest.CallInfo[None]) -> str | None:
    return None if call.excinfo is None else call.excinfo.exconly()[:500]


class Recorder:
    def __init__(self, config: pytest.Config) -> None:
        self.config = config
        self.outcomes: list[Outcome] = []
        self.lines: list[str] = []

    def _note(
        self, item: pytest.Item, report: pytest.TestReport, call: pytest.CallInfo[None]
    ) -> None:
        score = item.stash.get(SCORE, Score())
        recorded = 1.0 if score.value is None else score.value
        self.outcomes.append(
            Outcome(
                name=getattr(item, "originalname", item.name),
                nodeid=item.nodeid,
                case=_case(item),
                score=recorded if report.passed else 0.0,
                output=score.output,
                error=_error(call),
                metrics=dict(score.metrics),
                latency_ms=report.duration * 1000,
            )
        )

    @pytest.hookimpl(wrapper=True)
    def pytest_runtest_makereport(
        self, item: pytest.Item, call: pytest.CallInfo[None]
    ) -> Generator[None, pytest.TestReport, pytest.TestReport]:
        report = yield
        counted = report.when == "call" or (report.when == "setup" and report.failed)
        if counted and not report.skipped and _is_case(item):
            self._note(item, report, call)
        return report

    def _imported(self) -> ImportedRun:
        shared = Counter(outcome.case.id for outcome in self.outcomes if outcome.case is not None)
        cases: list[ImportedCase] = []
        for outcome in self.outcomes:
            case = outcome.case
            if case is None:
                case_id, given, expected = outcome.nodeid, None, None
            else:
                case_id = case.id if shared[case.id] == 1 else f"{outcome.name}::{case.id}"
                given, expected = case.input, case.expected
            cases.append(
                ImportedCase(
                    id=case_id,
                    input=given,
                    expected=expected,
                    score=outcome.score,
                    output=outcome.output,
                    error=outcome.error,
                    metrics=outcome.metrics,
                    latency_ms=outcome.latency_ms,
                )
            )
        return ImportedRun(self.config.getoption("modelstill_model"), SOURCE, tuple(cases))

    def _gate(self, history: History, session: pytest.Session, recorded: RecordedRun) -> None:
        option = self.config.getoption
        try:
            outcome = gate_run(
                history,
                recorded,
                load_gate(Path(option("modelstill_gate"))),
                option("modelstill_flip_rate"),
                option("modelstill_cost_ratio"),
                option("modelstill_p95_latency_ms"),
                option("modelstill_primary_metric"),
            )
        except ValueError as error:
            self.lines.append(f"gate FAILED: {error}")
            session.exitstatus = pytest.ExitCode.TESTS_FAILED
            return
        self.lines.extend(report_lines(recorded, outcome))
        if not outcome.decision.passed:
            session.exitstatus = pytest.ExitCode.TESTS_FAILED

    def pytest_sessionfinish(self, session: pytest.Session) -> None:
        if not self.outcomes:
            return
        history = History(Path(self.config.getoption("modelstill_history")))
        task = self.config.getoption("modelstill_task") or self.config.rootpath.name
        recorded = record_run(history, task, self._imported())
        self.lines.append(run_line(recorded))
        if self.config.getoption("modelstill_gate"):
            self._gate(history, session, recorded)

    def pytest_terminal_summary(self, terminalreporter: pytest.TerminalReporter) -> None:
        if not self.lines:
            return
        terminalreporter.section("modelstill")
        for line in self.lines:
            terminalreporter.write_line(line)
