import sys
import types
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest


@dataclass
class FakeImage:
    steps: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = field(default_factory=list)

    def _with(self, name: str, *args: Any, **kwargs: Any) -> "FakeImage":
        return FakeImage([*self.steps, (name, args, kwargs)])

    def uv_pip_install(self, *packages: str, **kwargs: Any) -> "FakeImage":
        return self._with("uv_pip_install", *packages, **kwargs)

    def pip_install(self, *packages: str, **kwargs: Any) -> "FakeImage":
        return self._with("pip_install", *packages, **kwargs)

    def env(self, values: dict[str, str]) -> "FakeImage":
        return self._with("env", values)

    def add_local_python_source(self, *modules: str, **kwargs: Any) -> "FakeImage":
        return self._with("add_local_python_source", *modules, **kwargs)

    def packages(self) -> list[str]:
        return [
            package
            for name, args, _ in self.steps
            if name in ("uv_pip_install", "pip_install")
            for package in args
        ]

    def environment(self) -> dict[str, str]:
        merged: dict[str, str] = {}
        for name, args, _ in self.steps:
            if name == "env":
                merged.update(args[0])
        return merged


class _ImageFactory:
    @staticmethod
    def debian_slim(python_version: str | None = None) -> FakeImage:
        return FakeImage([("debian_slim", (), {"python_version": python_version})])


@dataclass
class FakeBatch:
    volume: "FakeVolume"
    force: bool
    pending: list[tuple[Path, str]] = field(default_factory=list)

    def put_file(self, local: Path | str, remote: str) -> None:
        self.pending.append((Path(local), remote))


@dataclass
class FakeVolume:
    name: str
    create_if_missing: bool = False
    files: dict[str, bytes] = field(default_factory=dict)
    commits: int = 0

    @contextmanager
    def batch_upload(self, force: bool = False) -> Iterator[FakeBatch]:
        batch = FakeBatch(self, force)
        yield batch
        for local, remote in batch.pending:
            key = remote.lstrip("/")
            if key in self.files and not force:
                raise FileExistsError(remote)
            self.files[key] = local.read_bytes()

    def commit(self) -> None:
        self.commits += 1

    def reload(self) -> None:
        return None


@dataclass
class FakeSecret:
    name: str


@dataclass
class FakeFunction:
    fn: Callable[..., Any]
    options: dict[str, Any]
    app: "FakeApp"
    decorators: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    calls: list[tuple[dict[str, Any], tuple[Any, ...]]] = field(default_factory=list)
    result: Any = None

    def with_options(self, **options: Any) -> "FakeFunction":
        bound = FakeFunction(self.fn, {**self.options, **options}, self.app, self.decorators)
        bound.calls = self.calls
        bound.result = self.result
        return bound

    def remote(self, *args: Any) -> Any:
        if not self.app.running:
            raise RuntimeError("remote() called outside app.run()")
        self.calls.append((self.options, args))
        return self.result(*args) if callable(self.result) else self.result

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.fn(*args, **kwargs)


@dataclass
class FakeApp:
    name: str
    functions: dict[str, FakeFunction] = field(default_factory=dict)
    running: bool = False
    runs: int = 0

    def function(self, **options: Any) -> Callable[[Any], FakeFunction]:
        def register(fn: Any) -> FakeFunction:
            decorators: list[tuple[str, dict[str, Any]]] = getattr(fn, "_fake_decorators", [])
            wrapped = FakeFunction(getattr(fn, "_fake_inner", fn), options, self, decorators)
            self.functions[wrapped.fn.__name__] = wrapped
            return wrapped

        return register

    @contextmanager
    def run(self) -> Iterator["FakeApp"]:
        self.running = True
        self.runs += 1
        try:
            yield self
        finally:
            self.running = False


def _decorator(kind: str) -> Callable[..., Callable[[Any], Any]]:
    def make(**options: Any) -> Callable[[Any], Any]:
        def mark(fn: Any) -> Any:
            inner = getattr(fn, "_fake_inner", fn)

            def holder(*args: Any, **kwargs: Any) -> Any:
                return inner(*args, **kwargs)

            holder._fake_inner = inner  # pyright: ignore[reportFunctionMemberAccess]
            holder._fake_decorators = [  # pyright: ignore[reportFunctionMemberAccess]
                *getattr(fn, "_fake_decorators", []),
                (kind, options),
            ]
            return holder

        return mark

    return make


VOLUMES: dict[str, FakeVolume] = {}


def _volume_from_name(name: str, create_if_missing: bool = False) -> FakeVolume:
    return VOLUMES.setdefault(name, FakeVolume(name, create_if_missing))


@contextmanager
def _enable_output() -> Iterator[None]:
    yield


def install(monkeypatch: pytest.MonkeyPatch, local: bool = True) -> types.ModuleType:
    VOLUMES.clear()
    module = types.ModuleType("modal")
    module.App = FakeApp  # pyright: ignore[reportAttributeAccessIssue]
    module.Image = _ImageFactory  # pyright: ignore[reportAttributeAccessIssue]
    module.Volume = types.SimpleNamespace(from_name=_volume_from_name)  # pyright: ignore[reportAttributeAccessIssue]
    module.Secret = types.SimpleNamespace(from_name=FakeSecret)  # pyright: ignore[reportAttributeAccessIssue]
    module.concurrent = _decorator("concurrent")  # pyright: ignore[reportAttributeAccessIssue]
    module.web_server = _decorator("web_server")  # pyright: ignore[reportAttributeAccessIssue]
    module.enable_output = _enable_output  # pyright: ignore[reportAttributeAccessIssue]
    module.is_local = lambda: local  # pyright: ignore[reportAttributeAccessIssue]
    monkeypatch.setitem(sys.modules, "modal", module)
    monkeypatch.delitem(sys.modules, "modelstill.train.modal_backend", raising=False)
    return module
