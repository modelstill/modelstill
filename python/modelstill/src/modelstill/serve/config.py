import hashlib
import json
import os
import tempfile
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import IO, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from modelstill.serve.router import Deployment, Mode


def _read(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"{path}: a deployment file must hold a mapping")
    return data


def load_deployment(path: Path) -> Deployment:
    return Deployment.model_validate(_read(path))


def deployment_id(deployment: Deployment) -> str:
    canonical = json.dumps(deployment.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:12]


class DeploymentFile:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.current = load_deployment(path)
        self.last_error: str | None = None

    def reload(self) -> bool:
        try:
            fresh = load_deployment(self.path)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self.last_error = f"{type(error).__name__}: {error}"
            return False
        self.last_error = None
        if fresh == self.current:
            return False
        self.current = fresh
        return True


Record = Mapping[str, Any]
Fetch = Callable[[str], Record | None]
Opener = Callable[[urllib.request.Request, float], IO[bytes]]
Origin = Literal["file", "api"]


def deployment_from_record(fallback: Deployment, record: Record) -> Deployment:
    return Deployment.model_validate(
        {
            "task": fallback.task,
            "mode": record["mode"],
            "student_model": record.get("studentModel") or fallback.student_model,
            "threshold": record["threshold"],
            "shadow_sample": record["shadowSample"],
        }
    )


class DeploymentSource:
    def __init__(self, path: Path, fetch: Fetch | None = None) -> None:
        self.file = DeploymentFile(path)
        self.current = self.file.current
        self.origin: Origin = "file"
        self.api_error: str | None = None
        self._fetch = fetch

    @property
    def file_error(self) -> str | None:
        return self.file.last_error

    def reload(self) -> bool:
        file_changed = self.file.reload()
        fresh, origin = self._resolve(file_changed)
        changed = fresh != self.current
        self.current, self.origin = fresh, origin
        return changed

    def _resolve(self, file_changed: bool) -> tuple[Deployment, Origin]:
        if self._fetch is None:
            return self.file.current, "file"
        try:
            record = self._fetch(self.file.current.task)
            fresh = None if record is None else deployment_from_record(self.file.current, record)
        except Exception as error:  # noqa: BLE001
            self.api_error = f"{type(error).__name__}: {error}"
            if file_changed:
                return self.file.current, "file"
            return self.current, self.origin
        self.api_error = None
        if fresh is None:
            return self.file.current, "file"
        return fresh, "api"


def _default_opener(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class ApiSource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str
    token_env: str | None = None
    token_file: Path | None = None
    timeout: float = Field(default=2.0, gt=0)

    def token(self) -> str:
        if self.token_env and os.environ.get(self.token_env):
            return os.environ[self.token_env]
        if self.token_file is not None:
            return self.token_file.expanduser().read_text().strip()
        return ""


def api_fetcher(source: ApiSource, opener: Opener = _default_opener) -> Fetch:
    base = source.url.rstrip("/")

    def fetch(slug: str) -> Record | None:
        token = source.token()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        request = urllib.request.Request(
            f"{base}/v1/tasks/{urllib.parse.quote(slug, safe='')}/deployment",
            headers=headers,
            method="GET",
        )
        with opener(request, source.timeout) as response:
            reply = json.load(response)
        if not isinstance(reply, dict) or "deployment" not in reply:
            raise ValueError("the API reply holds no deployment field")
        record = reply["deployment"]
        if record is not None and not isinstance(record, dict):
            raise ValueError("the API deployment is not an object")
        return record

    return fetch


class Endpoint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    base_url: str
    model: str | None = None
    api_key_env: str | None = None
    api_key_file: Path | None = None
    timeout: float = Field(default=60.0, gt=0)

    def api_key(self) -> str:
        if self.api_key_env and os.environ.get(self.api_key_env):
            return os.environ[self.api_key_env]
        if self.api_key_file is not None:
            return self.api_key_file.expanduser().read_text().strip()
        return ""


class ClickHouseSink(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str
    table: str = "modelstill.serving_events"
    user: str | None = None
    password_env: str | None = None


class Sinks(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    clickhouse: ClickHouseSink | None = None
    jsonl: Path | None = None
    max_queue: int = Field(default=10_000, gt=0)
    batch_size: int = Field(default=200, gt=0)
    flush_seconds: float = Field(default=1.0, gt=0)


def _resolve(base: Path, path: Path | None) -> Path | None:
    if path is None:
        return None
    path = path.expanduser()
    return path if path.is_absolute() else base / path


class PluginTask(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    deployment: Path
    student: Endpoint
    cloud_model: str
    confidence: Literal["exp_mean_logprob", "min_token_prob"] = "exp_mean_logprob"


class PluginConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tasks: dict[str, PluginTask]
    sinks: Sinks = Sinks()
    api: ApiSource | None = None
    reload_seconds: float = Field(default=30.0, gt=0)


def load_plugin_config(path: Path) -> PluginConfig:
    config = PluginConfig.model_validate(_read(path))
    base = path.parent
    tasks = {
        name: task.model_copy(
            update={
                "deployment": _resolve(base, task.deployment),
                "student": task.student.model_copy(
                    update={"api_key_file": _resolve(base, task.student.api_key_file)}
                ),
            }
        )
        for name, task in config.tasks.items()
    }
    sinks = config.sinks.model_copy(update={"jsonl": _resolve(base, config.sinks.jsonl)})
    api = config.api
    if api is not None:
        api = api.model_copy(update={"token_file": _resolve(base, api.token_file)})
    return config.model_copy(update={"tasks": tasks, "sinks": sinks, "api": api})


def write_threshold(path: Path, threshold: float | None) -> None:
    _write_field(path, "threshold", threshold)


def write_mode(path: Path, mode: Mode) -> None:
    _write_field(path, "mode", mode)


def _write_field(path: Path, key: str, value: Any) -> None:
    data = _read(path)
    data[key] = value
    Deployment.model_validate(data)
    text = (
        json.dumps(data, indent=2) + "\n"
        if path.suffix == ".json"
        else yaml.safe_dump(data, sort_keys=False)
    )
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(handle, "w") as stream:
        stream.write(text)
    Path(temporary).replace(path)
