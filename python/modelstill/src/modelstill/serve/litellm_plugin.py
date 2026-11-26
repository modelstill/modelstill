import asyncio
import contextlib
import logging
import os
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import litellm
from litellm.llms.custom_llm import CustomLLM, CustomLLMError
from litellm.types.utils import ModelResponse, Usage

from modelstill.client import ChatClient
from modelstill.serve.backends import Chat, exp_mean_logprob, min_token_prob, openai_backend
from modelstill.serve.config import (
    ApiSource,
    DeploymentSource,
    Endpoint,
    Fetch,
    PluginConfig,
    Sinks,
    api_fetcher,
    deployment_id,
    load_plugin_config,
)
from modelstill.serve.events import request_hash, serving_row
from modelstill.serve.router import Answer, Model, Router, ServingEvent
from modelstill.sinks import BatchSink, ClickHouseWriter, JsonlWriter, Writer

__all__ = ["CONFIG_ENV", "ModelStillProvider", "proxy_cloud", "writers_from"]

CONFIG_ENV = "MODELSTILL_LITELLM_CONFIG"
_log = logging.getLogger(__name__)
_CONFIDENCE = {"exp_mean_logprob": exp_mean_logprob, "min_token_prob": min_token_prob}
_DROPPED = frozenset({"model", "messages", "stream", "stream_options"})

ChatFactory = Callable[[Endpoint], Chat]
CloudFactory = Callable[[str], Model]
ApiFactory = Callable[[ApiSource], Fetch]


def _client(endpoint: Endpoint) -> Chat:
    return ChatClient(endpoint.base_url, api_key=endpoint.api_key(), timeout=endpoint.timeout)


def writers_from(sinks: Sinks) -> dict[str, Writer]:
    writers: dict[str, Writer] = {}
    if sinks.clickhouse is not None:
        clickhouse = sinks.clickhouse
        writers["clickhouse"] = ClickHouseWriter(
            clickhouse.url,
            clickhouse.table,
            user=clickhouse.user,
            password=os.environ.get(clickhouse.password_env) if clickhouse.password_env else None,
        )
    if sinks.jsonl is not None:
        writers["jsonl"] = JsonlWriter(sinks.jsonl)
    return writers


def proxy_cloud(name: str) -> Model:
    async def call(request: dict) -> Answer:
        params = {key: value for key, value in request.items() if key not in _DROPPED}
        proxy = sys.modules.get("litellm.proxy.proxy_server")
        router = getattr(proxy, "llm_router", None)
        complete = router.acompletion if router is not None else litellm.acompletion
        response = await complete(model=name, messages=request["messages"], **params)
        if not isinstance(response, ModelResponse):
            raise TypeError(f"{name} answered with a stream; modelstill needs whole answers")
        raw = response.model_dump()
        text = response.choices[0].message.content or ""
        return Answer(text, response.model or name, None, raw)

    return call


@dataclass
class _Task:
    source: DeploymentSource
    router: Router


class ModelStillProvider(CustomLLM):
    def __init__(
        self,
        config: PluginConfig | None = None,
        chat_factory: ChatFactory = _client,
        cloud_factory: CloudFactory = proxy_cloud,
        writers: Mapping[str, Writer] | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        api_factory: ApiFactory = api_fetcher,
    ) -> None:
        super().__init__()
        self._config = config
        self._chat_factory = chat_factory
        self._cloud_factory = cloud_factory
        self._api_factory = api_factory
        self._writers = writers
        self._clock = clock
        self._tasks: dict[str, _Task] | None = None
        self._sinks: dict[str, BatchSink] = {}
        self._started = False
        self._last_reload = 0.0
        self._error: str | None = None
        if config is not None:
            self._load()

    def _load(self) -> dict[str, _Task]:
        if self._tasks is not None:
            return self._tasks
        config = self._config or load_plugin_config(Path(os.environ[CONFIG_ENV]))
        sinks = config.sinks
        writers = self._writers if self._writers is not None else writers_from(sinks)
        self._sinks = {
            name: BatchSink(writer, sinks.max_queue, sinks.batch_size, sinks.flush_seconds)
            for name, writer in writers.items()
        }
        fetch = self._api_factory(config.api) if config.api is not None else None
        tasks: dict[str, _Task] = {}
        for name, serving in config.tasks.items():
            source = DeploymentSource(serving.deployment, fetch)
            student = openai_backend(
                self._chat_factory(serving.student),
                model=lambda source=source: source.current.student_model,
                logprobs=True,
                confidence=_CONFIDENCE[serving.confidence],
            )
            tasks[name] = _Task(
                source, Router(source.current, student, self._cloud_factory(serving.cloud_model))
            )
        self._config = config
        self._tasks = tasks
        self._last_reload = float("-inf") if fetch is not None else self._clock().timestamp()
        return tasks

    async def _reload_if_due(self, tasks: dict[str, _Task]) -> None:
        assert self._config is not None
        now = self._clock().timestamp()
        if now - self._last_reload < self._config.reload_seconds:
            return
        self._last_reload = now
        for name, task in tasks.items():
            source = task.source
            if await asyncio.to_thread(source.reload):
                task.router.update(source.current)
                _log.info(
                    "task %s now runs deployment %s from the %s",
                    name,
                    deployment_id(source.current),
                    source.origin,
                )
            for problem in (source.file_error, source.api_error):
                if problem:
                    _log.warning("task %s keeps its deployment: %s", name, problem)

    def _start_sinks(self) -> None:
        if not self._started:
            for sink in self._sinks.values():
                sink.start()
            self._started = True

    def _emit(self, deployment: str, digest: str) -> Callable[[ServingEvent], None]:
        def emit(event: ServingEvent) -> None:
            row = serving_row(
                event, deployment_id=deployment, request_hash=digest, ts=self._clock()
            )
            for sink in self._sinks.values():
                sink.put(row)

        return emit

    async def acompletion(
        self,
        model: str,
        messages: list,
        api_base: str,
        custom_prompt_dict: dict,
        model_response: ModelResponse,
        print_verbose: Callable,
        encoding: Any,
        api_key: Any,
        logging_obj: Any,
        optional_params: dict,
        acompletion: Any = None,
        litellm_params: Any = None,
        logger_fn: Any = None,
        headers: dict | None = None,
        timeout: Any = None,
        client: Any = None,
    ) -> ModelResponse:
        try:
            tasks = self._load()
        except Exception as error:
            self._error = f"{type(error).__name__}: {error}"
            raise CustomLLMError(
                status_code=500, message=f"modelstill config: {self._error}"
            ) from error
        task = tasks.get(model)
        if task is None:
            raise CustomLLMError(status_code=404, message=f"unknown task {model!r}")
        if optional_params.get("stream"):
            raise CustomLLMError(status_code=400, message="streaming is not supported")
        await self._reload_if_due(tasks)
        self._start_sinks()
        request = {**optional_params, "messages": messages}
        emit = self._emit(deployment_id(task.router.deployment), request_hash(request))
        answer, _ = await task.router.respond(request, emit)
        return _fill(model_response, answer)

    def completion(self, *args: Any, **kwargs: Any) -> ModelResponse:
        raise CustomLLMError(status_code=400, message="modelstill serves async calls only")

    async def flush(self) -> None:
        for task in (self._tasks or {}).values():
            await task.router.drain()
        for sink in self._sinks.values():
            await sink.close()
        self._started = False

    def health(self) -> dict[str, Any]:
        with contextlib.suppress(Exception):
            self._load()
        return {
            "error": self._error,
            "tasks": {
                name: {
                    **task.source.current.model_dump(),
                    "deployment_id": deployment_id(task.source.current),
                    "deployment_source": task.source.origin,
                    "deployment_error": task.source.file_error,
                    "api_error": task.source.api_error,
                }
                for name, task in (self._tasks or {}).items()
            },
            "sinks": {name: sink.stats() for name, sink in self._sinks.items()},
        }


def _fill(response: ModelResponse, answer: Answer) -> ModelResponse:
    response.choices[0].message.content = answer.text
    response.model = answer.model
    usage = (answer.raw or {}).get("usage") or {}
    prompt = int(usage.get("prompt_tokens") or 0)
    completion = int(usage.get("completion_tokens") or 0)
    total = prompt + completion
    setattr(  # noqa: B010
        response,
        "usage",
        Usage(prompt_tokens=prompt, completion_tokens=completion, total_tokens=total),
    )
    response.created = int(time.time())
    return response
