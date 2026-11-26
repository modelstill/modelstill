from dataclasses import asdict, dataclass
from typing import Self, TypedDict

from pydantic import BaseModel, ConfigDict, Field

from modelstill.evals import Comparison, RunResult
from modelstill.spec import Gate


class Measurements(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    metric_mean: float
    metric_low: float
    metric_cases: int = Field(gt=0)
    flip_rate: float = Field(ge=0, le=1)
    cost_ratio: float = Field(ge=0)
    p95_latency_ms: int = Field(ge=0)
    baseline_difference_low: float | None = None

    @classmethod
    def from_run(
        cls,
        result: RunResult,
        flip_rate: float,
        cost_ratio: float,
        p95_latency_ms: int,
        baseline: Comparison | None = None,
    ) -> Self:
        return cls(
            metric_mean=result.mean,
            metric_low=result.low,
            metric_cases=len(result.scores),
            flip_rate=flip_rate,
            cost_ratio=cost_ratio,
            p95_latency_ms=p95_latency_ms,
            baseline_difference_low=None if baseline is None else baseline.low,
        )


class GateReport(TypedDict):
    passed: bool
    checks: list[dict[str, object]]


@dataclass(frozen=True)
class Check:
    name: str
    threshold: float
    value: float
    passed: bool


@dataclass(frozen=True)
class Decision:
    checks: tuple[Check, ...]

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    def to_report(self) -> GateReport:
        return {"passed": self.passed, "checks": [asdict(check) for check in self.checks]}


def _quality_checks(gate: Gate, measured: Measurements) -> list[Check]:
    checks: list[Check] = []
    if gate.lower_ci_min is not None:
        lower = measured.metric_low
        checks.append(
            Check("metric_lower_bound", gate.lower_ci_min, lower, lower >= gate.lower_ci_min)
        )
    if gate.max_regression is not None:
        if measured.baseline_difference_low is None:
            raise ValueError("this gate compares with the baseline; pass baseline_difference_low")
        low = measured.baseline_difference_low
        floor = -gate.max_regression
        checks.append(Check("regression_vs_baseline", floor, low, low >= floor))
    return checks


def decide(gate: Gate, measured: Measurements) -> Decision:
    return Decision(
        checks=(
            *_quality_checks(gate, measured),
            Check(
                "flip_rate",
                gate.max_flip_rate,
                measured.flip_rate,
                measured.flip_rate <= gate.max_flip_rate,
            ),
            Check(
                "cost_ratio",
                gate.max_cost_ratio,
                measured.cost_ratio,
                measured.cost_ratio <= gate.max_cost_ratio,
            ),
            Check(
                "p95_latency_ms",
                gate.max_p95_latency_ms,
                measured.p95_latency_ms,
                measured.p95_latency_ms <= gate.max_p95_latency_ms,
            ),
        )
    )
