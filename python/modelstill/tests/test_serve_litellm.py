import math
import sys
import types
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import litellm
import pytest
import yaml
from litellm.router import Router

from modelstill.client import ChatReply
from modelstill.serve.config import (
    ApiSource,
    Endpoint,
    PluginConfig,
    PluginTask,
    load_deployment,
    load_plugin_config,
)
from modelstill.serve.litellm_plugin import ModelStillProvider
from modelstill.serve.router import Answer

STUDENT = "technographics-v1-s1"
MESSAGES = [{"role": "user", "content": "Python and Snowflake"}]


class FakeStudent:
    def __init__(self, model: str = STUDENT, logprob: float = -0.01) -> None:
        self.model = model
        self.logprob = logprob
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def chat(self, model: str, messages: list[dict[str, str]], **params: Any) -> ChatReply:
        self.calls.append((model, params))
        usage = {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14}
        raw = {"model": self.model, "usage": usage}
        return ChatReply('{"technologies": ["student"]}', self.model, 11, 3, self.logprob, raw)


class FakeCloud:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, request: dict) -> Answer:
        self.calls.append(request)
        if self.fail:
            raise RuntimeError("cloud down")
        raw = {"usage": {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25}}
        return Answer('{"technologies": ["cloud"]}', "technographics-cloud", None, raw)


class Recorder:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def insert(self, rows: list[dict[str, Any]]) -> None:
        self.rows.extend(rows)


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 24, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


def deployment(path: Path, mode: str, threshold: float | None = 0.9, sample: float = 1.0) -> Path:
    path.write_text(
        yaml.safe_dump(
            {
                "task": "technographics",
                "mode": mode,
                "student_model": STUDENT,
                "threshold": threshold,
                "shadow_sample": sample,
            }
        )
    )
    return path


@pytest.fixture
def setup(tmp_path: Path):
    def make(mode: str, threshold: float | None = 0.9, student: FakeStudent | None = None):
        config = PluginConfig(
            tasks={
                "technographics": PluginTask(
                    deployment=deployment(tmp_path / "deploy.yaml", mode, threshold),
                    student=Endpoint(base_url="http://student"),
                    cloud_model="technographics-cloud",
                )
            },
            reload_seconds=30,
        )
        fake_student = student or FakeStudent()
        cloud = FakeCloud()
        recorder = Recorder()
        clock = Clock()
        provider = ModelStillProvider(
            config,
            chat_factory=lambda endpoint: fake_student,
            cloud_factory=lambda name: cloud,
            writers={"memory": recorder},
            clock=clock,
        )
        litellm.custom_provider_map = [{"provider": "modelstill", "custom_handler": provider}]
        litellm.utils.custom_llm_setup()
        return provider, fake_student, cloud, recorder, clock

    yield make
    litellm.custom_provider_map = []


async def ask(**params: Any) -> Any:
    return await litellm.acompletion(model="modelstill/technographics", messages=MESSAGES, **params)


async def test_off_mode_forwards_the_request_to_the_cloud_model_and_logs_it(setup) -> None:
    provider, student, cloud, recorder, _ = setup("off")

    response = await ask(temperature=0, max_tokens=2000, response_format={"type": "json_object"})
    await provider.flush()

    assert response.choices[0].message.content == '{"technologies": ["cloud"]}'
    assert response.model == "technographics-cloud"
    assert cloud.calls[0]["messages"] == MESSAGES
    assert cloud.calls[0]["temperature"] == 0
    assert cloud.calls[0]["max_tokens"] == 2000
    assert cloud.calls[0]["response_format"] == {"type": "json_object"}
    assert student.calls == []
    assert [row["served_from"] for row in recorder.rows] == ["cloud"]
    assert recorder.rows[0]["task"] == "technographics"


async def test_usage_is_the_answering_model_s_so_the_proxy_can_price_the_call(setup) -> None:
    setup("off")

    response = await ask()

    assert (response.usage.prompt_tokens, response.usage.completion_tokens) == (20, 5)


async def test_a_confident_deployed_student_answers_in_serve_mode(setup) -> None:
    provider, student, cloud, recorder, _ = setup("serve")

    response = await ask(temperature=0)
    await provider.flush()

    assert response.choices[0].message.content == '{"technologies": ["student"]}'
    assert response.model == STUDENT
    assert (response.usage.prompt_tokens, response.usage.completion_tokens) == (11, 3)
    assert student.calls[0][0] == STUDENT
    assert student.calls[0][1]["logprobs"] is True
    assert cloud.calls == []
    assert recorder.rows[0]["served_from"] == "student"
    assert recorder.rows[0]["confidence"] == pytest.approx(math.exp(-0.01))


async def test_an_unsure_student_defers_to_the_cloud_model(setup) -> None:
    provider, _, _, recorder, _ = setup("serve", student=FakeStudent(logprob=-1.0))

    response = await ask()
    await provider.flush()

    assert response.choices[0].message.content == '{"technologies": ["cloud"]}'
    assert recorder.rows[0]["deferred"] is True
    assert recorder.rows[0]["reason"] == "low_confidence"
    assert recorder.rows[0]["student_output"] == '{"technologies": ["student"]}'


async def test_an_answer_from_another_model_is_never_served(setup) -> None:
    provider, _, _, recorder, _ = setup("serve", student=FakeStudent(model="Qwen/Qwen3-4B"))

    response = await ask()
    await provider.flush()

    assert response.model == "technographics-cloud"
    assert recorder.rows[0]["reason"] == "model_mismatch"


async def test_shadow_mode_answers_from_the_cloud_and_logs_both_answers(setup) -> None:
    provider, student, _, recorder, _ = setup("shadow")

    response = await ask()
    await provider.flush()

    assert response.choices[0].message.content == '{"technologies": ["cloud"]}'
    assert len(student.calls) == 1
    assert recorder.rows[0]["student_output"] == '{"technologies": ["student"]}'
    assert recorder.rows[0]["cloud_output"] == '{"technologies": ["cloud"]}'


async def test_an_edited_deployment_file_applies_after_the_reload_interval(
    setup, tmp_path: Path
) -> None:
    provider, _, _, recorder, clock = setup("off")
    deployment(tmp_path / "deploy.yaml", "serve")

    await ask()
    clock.now += timedelta(seconds=31)
    second = await ask()
    await provider.flush()

    assert [row["mode"] for row in recorder.rows] == ["off", "serve"]
    assert second.model == STUDENT


async def test_a_broken_deployment_edit_keeps_the_last_good_one(setup, tmp_path: Path) -> None:
    provider, _, _, recorder, clock = setup("off")
    (tmp_path / "deploy.yaml").write_text("mode: [")

    clock.now += timedelta(seconds=31)
    await ask()
    await provider.flush()

    assert recorder.rows[0]["mode"] == "off"
    assert provider.health()["tasks"]["technographics"]["deployment_error"]


async def test_a_cloud_failure_raises_so_litellm_can_fall_back(setup) -> None:
    provider, _, cloud, _, _ = setup("off")
    cloud.fail = True

    with pytest.raises(Exception, match="cloud down"):
        await ask(num_retries=0)


async def test_an_unknown_task_is_refused(setup) -> None:
    setup("off")

    with pytest.raises(Exception, match="unknown task"):
        await litellm.acompletion(model="modelstill/other", messages=MESSAGES, num_retries=0)


async def test_the_config_is_read_from_the_environment_on_first_use(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deployment(tmp_path / "deploy.yaml", "off")
    (tmp_path / "plugin.yaml").write_text(
        yaml.safe_dump(
            {
                "tasks": {
                    "technographics": {
                        "deployment": "deploy.yaml",
                        "student": {"base_url": "http://student"},
                        "cloud_model": "technographics-cloud",
                    }
                }
            }
        )
    )
    monkeypatch.setenv("MODELSTILL_LITELLM_CONFIG", str(tmp_path / "plugin.yaml"))
    cloud = FakeCloud()

    provider = ModelStillProvider(cloud_factory=lambda name: cloud, writers={})
    assert provider.health()["tasks"]["technographics"]["mode"] == "off"


class FakeDeploymentApi:
    def __init__(self, record: dict[str, Any] | None) -> None:
        self.record = record
        self.down = False
        self.calls = 0

    def __call__(self, slug: str) -> dict[str, Any] | None:
        self.calls += 1
        if self.down:
            raise OSError("connection refused")
        return self.record


def api_record(mode: str, threshold: float | None = 0.9, sample: float = 1.0) -> dict[str, Any]:
    return {
        "mode": mode,
        "studentModel": STUDENT,
        "threshold": threshold,
        "targetError": 0.05,
        "shadowSample": sample,
        "activeFrom": "2026-11-24T00:00:00.000Z",
    }


@pytest.fixture
def with_api(tmp_path: Path):
    def make(file_mode: str, record: dict[str, Any] | None):
        api = FakeDeploymentApi(record)
        config = PluginConfig(
            tasks={
                "technographics": PluginTask(
                    deployment=deployment(tmp_path / "deploy.yaml", file_mode),
                    student=Endpoint(base_url="http://student"),
                    cloud_model="technographics-cloud",
                )
            },
            api=ApiSource(url="http://api.test", token_env="MODELSTILL_TEST_TOKEN"),
            reload_seconds=30,
        )
        recorder = Recorder()
        clock = Clock()
        cloud = FakeCloud()
        provider = ModelStillProvider(
            config,
            chat_factory=lambda endpoint: FakeStudent(),
            cloud_factory=lambda name: cloud,
            writers={"memory": recorder},
            clock=clock,
            api_factory=lambda source: api,
        )
        litellm.custom_provider_map = [{"provider": "modelstill", "custom_handler": provider}]
        litellm.utils.custom_llm_setup()
        return provider, api, recorder, clock

    yield make
    litellm.custom_provider_map = []


async def test_the_api_deployment_applies_from_the_first_request(with_api) -> None:
    provider, api, recorder, _ = with_api("off", api_record("serve"))

    response = await ask()
    await provider.flush()

    assert api.calls == 1
    assert response.model == STUDENT
    assert recorder.rows[0]["mode"] == "serve"
    task = provider.health()["tasks"]["technographics"]
    assert task["mode"] == "serve" and task["deployment_source"] == "api"


async def test_a_mode_set_in_the_api_reaches_the_running_proxy_with_a_new_deployment_id(
    with_api,
) -> None:
    provider, api, recorder, clock = with_api("off", api_record("shadow"))

    await ask()
    api.record = api_record("serve")
    clock.now += timedelta(seconds=10)
    await ask()
    clock.now += timedelta(seconds=31)
    await ask()
    api.record = api_record("serve", threshold=0.95)
    clock.now += timedelta(seconds=31)
    await ask()
    await provider.flush()

    assert [row["mode"] for row in recorder.rows] == ["shadow", "shadow", "serve", "serve"]
    ids = [row["deployment_id"] for row in recorder.rows]
    assert ids[0] == ids[1] and len({ids[1], ids[2], ids[3]}) == 3
    assert api.calls == 3


async def test_an_unreachable_api_keeps_the_last_good_deployment_and_says_so(with_api) -> None:
    provider, api, recorder, clock = with_api("off", api_record("serve"))
    await ask()
    api.down = True
    clock.now += timedelta(seconds=31)

    response = await ask()
    await provider.flush()

    assert response.model == STUDENT
    assert [row["mode"] for row in recorder.rows] == ["serve", "serve"]
    task = provider.health()["tasks"]["technographics"]
    assert "connection refused" in task["api_error"]
    assert task["deployment_source"] == "api"


async def test_without_an_api_record_the_file_deployment_serves(with_api) -> None:
    provider, _, recorder, _ = with_api("shadow", None)

    await ask()
    await provider.flush()

    assert recorder.rows[0]["mode"] == "shadow"
    assert provider.health()["tasks"]["technographics"]["deployment_source"] == "file"


def proxy_router(cloud_reply: str | None) -> Router:
    return Router(
        model_list=[
            {
                "model_name": "technographics",
                "litellm_params": {"model": "modelstill/technographics"},
            },
            {
                "model_name": "technographics-cloud",
                "litellm_params": (
                    {"model": "openai/cloud", "api_key": "x", "mock_response": cloud_reply}
                    if cloud_reply is not None
                    else {"model": "openai/cloud", "api_key": "x", "api_base": "http://127.0.0.1:9"}
                ),
            },
            {
                "model_name": "technographics-fallback",
                "litellm_params": {
                    "model": "openai/fallback",
                    "api_key": "x",
                    "mock_response": '{"technologies": ["fallback"]}',
                },
            },
        ],
        fallbacks=[
            {"technographics": ["technographics-fallback"]},
            {"technographics-cloud": ["technographics-fallback"]},
        ],
        num_retries=0,
    )


@pytest.fixture
def in_proxy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def make(mode: str, cloud_reply: str | None, student: FakeStudent | None = None):
        router = proxy_router(cloud_reply)
        monkeypatch.setitem(
            sys.modules, "litellm.proxy.proxy_server", types.SimpleNamespace(llm_router=router)
        )
        config = PluginConfig(
            tasks={
                "technographics": PluginTask(
                    deployment=deployment(tmp_path / "deploy.yaml", mode),
                    student=Endpoint(base_url="http://student"),
                    cloud_model="technographics-cloud",
                )
            }
        )
        fake = student or FakeStudent()
        provider = ModelStillProvider(config, chat_factory=lambda e: fake, writers={})
        litellm.custom_provider_map = [{"provider": "modelstill", "custom_handler": provider}]
        litellm.utils.custom_llm_setup()
        return router

    yield make
    litellm.custom_provider_map = []


async def test_the_cloud_answer_comes_from_the_proxy_s_own_router(in_proxy) -> None:
    router = in_proxy("off", '{"technologies": ["cloud"]}')

    response = await router.acompletion(model="technographics", messages=MESSAGES)

    assert response.choices[0].message.content == '{"technologies": ["cloud"]}'


async def test_when_the_plugin_fails_litellm_s_fallback_answers(in_proxy) -> None:
    router = in_proxy("off", None)
    router.fallbacks = [{"technographics": ["technographics-fallback"]}]

    response = await router.acompletion(model="technographics", messages=MESSAGES)

    assert response.choices[0].message.content == '{"technologies": ["fallback"]}'


def test_the_shipped_example_configs_load() -> None:
    folder = Path(__file__).resolve().parents[3] / "deploy" / "litellm"
    config = load_plugin_config(folder / "plugin.yaml")

    task = config.tasks["technographics"]
    assert task.cloud_model == "technographics-cloud"
    assert not task.student.base_url.endswith("/v1")
    assert load_deployment(task.deployment).mode == "off"
