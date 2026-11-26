import asyncio

import pytest

from modelstill.serve.router import Answer, Deployment, Mode, Router, ServingEvent


class FakeModel:
    def __init__(self, answer: Answer | None = None, error: Exception | None = None) -> None:
        self.answer = answer
        self.error = error
        self.calls = 0

    async def __call__(self, request: dict) -> Answer:
        self.calls += 1
        if self.error is not None:
            raise self.error
        assert self.answer is not None
        return self.answer


REQUEST = {"messages": [{"role": "user", "content": "Python and Snowflake required."}]}
STUDENT_NAME = "technographics-v3-s1"


def student(confidence: float = 0.9, model: str = STUDENT_NAME) -> FakeModel:
    return FakeModel(Answer(text='{"technologies": []}', model=model, confidence=confidence))


def cloud() -> FakeModel:
    return FakeModel(Answer(text='{"technologies": [{"name": "Python"}]}', model="deepseek-v4"))


def deployment(mode: Mode, threshold: float | None = 0.5, sample: float = 1.0) -> Deployment:
    return Deployment(
        task="technographics",
        mode=mode,
        student_model=STUDENT_NAME,
        threshold=threshold,
        shadow_sample=sample,
    )


async def route(router: Router) -> tuple[Answer, list[ServingEvent]]:
    events: list[ServingEvent] = []
    answer = await router.handle(REQUEST, events.append)
    await router.drain()
    return answer, events


async def test_off_mode_only_calls_the_cloud_and_logs_it() -> None:
    small, big = student(), cloud()

    answer, events = await route(Router(deployment("off"), small, big))

    assert answer.model == "deepseek-v4"
    assert small.calls == 0
    assert [event.served_from for event in events] == ["cloud"]


async def test_serve_mode_answers_with_a_confident_student() -> None:
    small, big = student(confidence=0.9), cloud()

    answer, events = await route(Router(deployment("serve"), small, big))

    assert answer.model == STUDENT_NAME
    assert big.calls == 0
    assert events[0].served_from == "student"
    assert events[0].deferred is False
    assert events[0].confidence == 0.9


async def test_serve_mode_defers_below_the_threshold_and_logs_both_answers() -> None:
    small, big = student(confidence=0.2), cloud()

    answer, events = await route(Router(deployment("serve"), small, big))

    assert answer.model == "deepseek-v4"
    event = events[0]
    assert event.deferred is True
    assert event.reason == "low_confidence"
    assert event.student_output == '{"technologies": []}'
    assert event.cloud_output == '{"technologies": [{"name": "Python"}]}'


async def test_serve_mode_defers_when_the_wrong_model_answered() -> None:
    small, big = student(confidence=0.99, model="Qwen/Qwen3-1.7B"), cloud()

    answer, events = await route(Router(deployment("serve"), small, big))

    assert answer.model == "deepseek-v4"
    assert events[0].reason == "model_mismatch"
    assert events[0].model_match is False


async def test_serve_mode_defers_when_the_student_fails() -> None:
    small, big = FakeModel(error=TimeoutError()), cloud()

    answer, events = await route(Router(deployment("serve"), small, big))

    assert answer.model == "deepseek-v4"
    assert events[0].reason == "student_error"


async def test_serve_mode_without_a_threshold_defers_everything() -> None:
    small, big = student(confidence=0.99), cloud()

    answer, _ = await route(Router(deployment("serve", threshold=None), small, big))

    assert answer.model == "deepseek-v4"


async def test_shadow_mode_answers_from_the_cloud_and_records_the_student_too() -> None:
    small, big = student(confidence=0.7), cloud()

    answer, events = await route(Router(deployment("shadow"), small, big))

    assert answer.model == "deepseek-v4"
    assert small.calls == 1
    assert events[0].served_from == "cloud"
    assert events[0].student_output == '{"technologies": []}'
    assert events[0].confidence == 0.7


async def test_shadow_mode_respects_the_sample_rate() -> None:
    small, big = student(), cloud()

    router = Router(deployment("shadow", sample=0.0), small, big)
    _, events = await route(router)

    assert small.calls == 0
    assert events[0].student_output is None


async def test_a_slow_shadow_student_never_delays_the_answer() -> None:
    class Slow(FakeModel):
        async def __call__(self, request: dict) -> Answer:
            await asyncio.sleep(10)
            return await super().__call__(request)

    router = Router(deployment("shadow"), Slow(Answer("x", STUDENT_NAME, 0.5)), cloud())

    answer = await asyncio.wait_for(router.handle(REQUEST, lambda event: None), timeout=1)

    assert answer.model == "deepseek-v4"
    router.cancel_background()


async def test_update_swaps_the_deployment_for_later_requests() -> None:
    small, big = student(confidence=0.9), cloud()
    router = Router(deployment("off"), small, big)

    router.update(deployment("serve"))
    answer, events = await route(router)

    assert router.deployment.mode == "serve"
    assert answer.model == STUDENT_NAME
    assert events[0].mode == "serve"


async def test_answers_keep_the_raw_response_of_the_model_that_gave_them() -> None:
    raw = {"id": "chatcmpl-1", "choices": [{"message": {"content": "x"}}]}
    big = FakeModel(Answer(text="x", model="deepseek-v4", raw=raw))

    answer, _ = await route(Router(deployment("off"), student(), big))

    assert answer.raw == raw


@pytest.mark.parametrize(
    ("mode", "confidence", "served_from"),
    [("serve", 0.9, "student"), ("serve", 0.1, "cloud"), ("shadow", 0.9, "cloud")],
)
async def test_respond_says_which_model_served_the_answer(
    mode: Mode, confidence: float, served_from: str
) -> None:
    router = Router(deployment(mode), student(confidence=confidence), cloud())

    _, source = await router.respond(REQUEST, lambda event: None)
    await router.drain()

    assert source == served_from


def test_unknown_mode_is_rejected() -> None:
    with pytest.raises(ValueError):
        Deployment.model_validate(
            {
                "task": "t",
                "mode": "live",
                "student_model": "s",
                "threshold": 0.5,
                "shadow_sample": 1,
            }
        )
