import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


@dataclass(frozen=True)
class Answer:
    text: str
    model: str
    confidence: float | None = None
    raw: dict[str, Any] | None = field(default=None, repr=False, compare=False)


Mode = Literal["off", "shadow", "serve"]
Source = Literal["student", "cloud"]


class Deployment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task: str
    mode: Mode
    student_model: str
    threshold: float | None = Field(ge=0, le=1)
    shadow_sample: float = Field(ge=0, le=1)

    @field_validator("mode", mode="before")
    @classmethod
    def _yaml_off(cls, value: object) -> object:
        return "off" if value is False else value


@dataclass(frozen=True)
class ServingEvent:
    task: str
    mode: str
    served_from: Source
    deferred: bool
    reason: str | None
    confidence: float | None
    student_output: str | None
    student_model: str | None
    model_match: bool | None
    cloud_output: str | None
    cloud_model: str | None
    student_ms: float | None
    cloud_ms: float | None


Model = Callable[[dict], Awaitable[Answer]]
Emit = Callable[[ServingEvent], None]


@dataclass(frozen=True)
class _Timed:
    answer: Answer | None
    ms: float


async def _timed(model: Model, request: dict) -> _Timed:
    started = time.perf_counter()
    try:
        answer = await model(request)
    except Exception:  # noqa: BLE001
        return _Timed(None, (time.perf_counter() - started) * 1000)
    return _Timed(answer, (time.perf_counter() - started) * 1000)


class Router:
    def __init__(
        self,
        deployment: Deployment,
        student: Model,
        cloud: Model,
        sampler: Callable[[], float] = random.random,
    ) -> None:
        self._deployment = deployment
        self._student = student
        self._cloud = cloud
        self._sampler = sampler
        self._background: set[asyncio.Task[None]] = set()

    async def handle(self, request: dict, emit: Emit) -> Answer:
        answer, _ = await self.respond(request, emit)
        return answer

    async def respond(self, request: dict, emit: Emit) -> tuple[Answer, Source]:
        mode = self._deployment.mode
        if mode == "serve":
            return await self._serve(request, emit)
        started = time.perf_counter()
        answer = await self._cloud(request)
        cloud_ms = (time.perf_counter() - started) * 1000
        if mode == "shadow" and self._sampler() < self._deployment.shadow_sample:
            task = asyncio.create_task(self._shadow(request, answer, cloud_ms, emit))
            self._background.add(task)
            task.add_done_callback(self._background.discard)
        else:
            emit(self._event("cloud", False, None, None, answer, cloud_ms))
        return answer, "cloud"

    @property
    def deployment(self) -> Deployment:
        return self._deployment

    def update(self, deployment: Deployment) -> None:
        self._deployment = deployment

    async def drain(self) -> None:
        if self._background:
            await asyncio.gather(*self._background)

    def cancel_background(self) -> None:
        for task in self._background:
            task.cancel()

    async def _shadow(self, request: dict, cloud: Answer, cloud_ms: float, emit: Emit) -> None:
        student = await _timed(self._student, request)
        emit(self._event("cloud", False, None, student, cloud, cloud_ms))

    async def _serve(self, request: dict, emit: Emit) -> tuple[Answer, Source]:
        student = await _timed(self._student, request)
        reason = self._defer_reason(student.answer)
        if reason is None and student.answer is not None:
            emit(self._event("student", False, None, student, None, None))
            return student.answer, "student"
        started = time.perf_counter()
        cloud = await self._cloud(request)
        cloud_ms = (time.perf_counter() - started) * 1000
        emit(self._event("cloud", True, reason, student, cloud, cloud_ms))
        return cloud, "cloud"

    def _defer_reason(self, answer: Answer | None) -> str | None:
        if answer is None:
            return "student_error"
        if answer.model != self._deployment.student_model:
            return "model_mismatch"
        if self._deployment.threshold is None:
            return "no_threshold"
        if answer.confidence is None:
            return "no_confidence"
        if answer.confidence < self._deployment.threshold:
            return "low_confidence"
        return None

    def _event(
        self,
        served_from: Source,
        deferred: bool,
        reason: str | None,
        student: _Timed | None,
        cloud: Answer | None,
        cloud_ms: float | None,
    ) -> ServingEvent:
        student_answer = student.answer if student is not None else None
        return ServingEvent(
            task=self._deployment.task,
            mode=self._deployment.mode,
            served_from=served_from,
            deferred=deferred,
            reason=reason,
            confidence=student_answer.confidence if student_answer else None,
            student_output=student_answer.text if student_answer else None,
            student_model=student_answer.model if student_answer else None,
            model_match=(
                student_answer.model == self._deployment.student_model if student_answer else None
            ),
            cloud_output=cloud.text if cloud else None,
            cloud_model=cloud.model if cloud else None,
            student_ms=student.ms if student is not None else None,
            cloud_ms=cloud_ms,
        )
