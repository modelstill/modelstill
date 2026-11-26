import io
import json
import urllib.request
from pathlib import Path
from typing import Any

import pytest
import yaml
from pydantic import ValidationError

from modelstill.serve.config import (
    ApiSource,
    DeploymentFile,
    DeploymentSource,
    api_fetcher,
    deployment_id,
    load_deployment,
    load_plugin_config,
    write_mode,
    write_threshold,
)

DEPLOYMENT = {
    "task": "technographics",
    "mode": "shadow",
    "student_model": "technographics-v1-s1",
    "threshold": 0.8,
    "shadow_sample": 0.5,
}


def write_yaml(path: Path, **changes: object) -> Path:
    path.write_text(yaml.safe_dump({**DEPLOYMENT, **changes}))
    return path


def test_loads_a_yaml_deployment(tmp_path: Path) -> None:
    deployment = load_deployment(write_yaml(tmp_path / "d.yaml"))

    assert deployment.mode == "shadow"
    assert deployment.threshold == 0.8


def test_loads_a_json_deployment(tmp_path: Path) -> None:
    path = tmp_path / "d.json"
    path.write_text(json.dumps(DEPLOYMENT))

    assert load_deployment(path).student_model == "technographics-v1-s1"


def test_rejects_an_invalid_deployment(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        load_deployment(write_yaml(tmp_path / "d.yaml", mode="live"))


def test_the_deployment_id_changes_with_any_setting(tmp_path: Path) -> None:
    first = load_deployment(write_yaml(tmp_path / "a.yaml"))
    same = load_deployment(write_yaml(tmp_path / "b.yaml"))
    other = load_deployment(write_yaml(tmp_path / "c.yaml", threshold=0.9))

    assert deployment_id(first) == deployment_id(same)
    assert deployment_id(first) != deployment_id(other)
    assert len(deployment_id(first)) == 12


def test_reload_picks_up_a_changed_file(tmp_path: Path) -> None:
    path = write_yaml(tmp_path / "d.yaml")
    watched = DeploymentFile(path)

    assert watched.reload() is False
    write_yaml(path, mode="off")

    assert watched.reload() is True
    assert watched.current.mode == "off"


def test_reload_keeps_the_last_good_deployment_when_the_file_breaks(tmp_path: Path) -> None:
    path = write_yaml(tmp_path / "d.yaml")
    watched = DeploymentFile(path)
    path.write_text("mode: [unclosed")

    assert watched.reload() is False
    assert watched.current.mode == "shadow"
    assert watched.last_error is not None


def test_reload_clears_the_error_once_the_file_is_fixed(tmp_path: Path) -> None:
    path = write_yaml(tmp_path / "d.yaml")
    watched = DeploymentFile(path)
    path.unlink()
    watched.reload()

    write_yaml(path, mode="serve")

    assert watched.reload() is True
    assert watched.last_error is None


def test_write_threshold_keeps_every_other_setting(tmp_path: Path) -> None:
    path = write_yaml(tmp_path / "d.yaml")

    write_threshold(path, 0.93)

    assert yaml.safe_load(path.read_text()) == {**DEPLOYMENT, "threshold": 0.93}


def test_write_threshold_can_clear_it(tmp_path: Path) -> None:
    path = tmp_path / "d.json"
    path.write_text(json.dumps(DEPLOYMENT))

    write_threshold(path, None)

    assert json.loads(path.read_text())["threshold"] is None


def test_write_mode_switches_the_deployment_off_and_keeps_the_rest(tmp_path: Path) -> None:
    path = write_yaml(tmp_path / "d.yaml")

    write_mode(path, "off")

    assert yaml.safe_load(path.read_text()) == {**DEPLOYMENT, "mode": "off"}


def test_an_unquoted_off_rolls_the_task_back(tmp_path: Path) -> None:
    path = tmp_path / "d.yaml"
    path.write_text(yaml.safe_dump(DEPLOYMENT).replace("mode: shadow", "mode: off"))
    watched = DeploymentFile(write_yaml(tmp_path / "start.yaml"))
    watched.path = path

    assert load_deployment(path).mode == "off"
    assert watched.reload()
    assert watched.current.mode == "off"


def test_a_bare_on_is_not_a_mode(tmp_path: Path) -> None:
    path = tmp_path / "d.yaml"
    path.write_text(yaml.safe_dump(DEPLOYMENT).replace("mode: shadow", "mode: on"))

    with pytest.raises(ValidationError):
        load_deployment(path)


RECORD = {
    "mode": "serve",
    "studentModel": "technographics-v2-s1",
    "threshold": 0.93,
    "targetError": 0.05,
    "shadowSample": 0.2,
    "activeFrom": "2026-11-25T00:00:00.000Z",
}


class FakeApi:
    def __init__(self, record: dict[str, Any] | None = None) -> None:
        self.record = record
        self.error: Exception | None = None
        self.slugs: list[str] = []

    def __call__(self, slug: str) -> dict[str, Any] | None:
        self.slugs.append(slug)
        if self.error is not None:
            raise self.error
        return self.record


def test_without_an_api_the_source_is_the_file(tmp_path: Path) -> None:
    path = write_yaml(tmp_path / "d.yaml")
    source = DeploymentSource(path)
    write_yaml(path, mode="serve")

    assert source.reload() is True
    assert source.current.mode == "serve"
    assert source.origin == "file"


def test_the_api_record_wins_over_the_file(tmp_path: Path) -> None:
    api = FakeApi(RECORD)
    source = DeploymentSource(write_yaml(tmp_path / "d.yaml"), api)

    assert source.reload() is True

    assert api.slugs == ["technographics"]
    assert source.origin == "api"
    assert source.current.model_dump() == {
        "task": "technographics",
        "mode": "serve",
        "student_model": "technographics-v2-s1",
        "threshold": 0.93,
        "shadow_sample": 0.2,
    }


def test_a_record_without_a_student_keeps_the_file_s_student(tmp_path: Path) -> None:
    source = DeploymentSource(
        write_yaml(tmp_path / "d.yaml"), FakeApi({**RECORD, "studentModel": None, "mode": "off"})
    )

    source.reload()

    assert source.current.mode == "off"
    assert source.current.student_model == "technographics-v1-s1"


def test_no_record_in_the_api_leaves_the_file_in_charge(tmp_path: Path) -> None:
    api = FakeApi(RECORD)
    source = DeploymentSource(write_yaml(tmp_path / "d.yaml"), api)
    source.reload()
    api.record = None

    assert source.reload() is True
    assert source.current.mode == "shadow"
    assert source.origin == "file"


def test_an_unreachable_api_keeps_the_last_good_deployment(tmp_path: Path) -> None:
    api = FakeApi(RECORD)
    source = DeploymentSource(write_yaml(tmp_path / "d.yaml"), api)
    source.reload()
    api.error = OSError("connection refused")

    assert source.reload() is False
    assert source.current.mode == "serve"
    assert source.origin == "api"
    assert source.api_error is not None and "connection refused" in source.api_error

    api.error = None
    source.reload()
    assert source.api_error is None


def test_an_invalid_record_keeps_the_last_good_deployment(tmp_path: Path) -> None:
    api = FakeApi(RECORD)
    source = DeploymentSource(write_yaml(tmp_path / "d.yaml"), api)
    source.reload()

    for broken in ({**RECORD, "mode": "live"}, {"mode": "off"}, {**RECORD, "threshold": 2}):
        api.record = broken
        assert source.reload() is False
        assert source.current.mode == "serve"
        assert source.api_error is not None


def test_a_file_edit_applies_while_the_api_is_unreachable(tmp_path: Path) -> None:
    api = FakeApi(RECORD)
    path = write_yaml(tmp_path / "d.yaml")
    source = DeploymentSource(path, api)
    source.reload()
    api.error = OSError("down")
    write_yaml(path, mode="off")

    assert source.reload() is True
    assert source.current.mode == "off"
    assert source.origin == "file"

    api.error = None
    assert source.reload() is True
    assert source.current.mode == "serve"


def test_each_api_change_is_a_new_deployment_id(tmp_path: Path) -> None:
    api = FakeApi(RECORD)
    source = DeploymentSource(write_yaml(tmp_path / "d.yaml"), api)
    seen = set()
    for change in ({}, {"threshold": 0.95}, {"shadowSample": 0.5}, {"mode": "shadow"}):
        api.record = {**RECORD, **change}
        source.reload()
        seen.add(deployment_id(source.current))

    assert len(seen) == 4


class Opener:
    def __init__(self, reply: object) -> None:
        self.reply = reply
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> io.BytesIO:
        self.requests.append(request)
        return io.BytesIO(json.dumps(self.reply).encode())


def test_the_fetcher_reads_the_task_deployment_with_the_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "token").write_text("from-file\n")
    opener = Opener({"deployment": RECORD})
    source = ApiSource(url="http://api.test/", token_file=tmp_path / "token")

    assert api_fetcher(source, opener)("technographics") == RECORD

    [request] = opener.requests
    assert request.full_url == "http://api.test/v1/tasks/technographics/deployment"
    assert request.get_method() == "GET"
    assert request.get_header("Authorization") == "Bearer from-file"
    monkeypatch.setenv("MS_TOKEN", "from-env")
    api_fetcher(source.model_copy(update={"token_env": "MS_TOKEN"}), opener)("t")
    assert opener.requests[1].get_header("Authorization") == "Bearer from-env"


def test_the_fetcher_refuses_a_reply_that_is_not_a_deployment(tmp_path: Path) -> None:
    source = ApiSource(url="http://api.test", token_env="MS_TOKEN_UNSET")

    assert api_fetcher(source, Opener({"deployment": None}))("t") is None
    with pytest.raises(ValueError, match="deployment"):
        api_fetcher(source, Opener(["not", "a", "reply"]))("t")
    with pytest.raises(ValueError, match="deployment"):
        api_fetcher(source, Opener({"deployment": "off"}))("t")


def test_the_plugin_config_resolves_the_api_token_file(tmp_path: Path) -> None:
    write_yaml(tmp_path / "d.yaml")
    (tmp_path / "plugin.yaml").write_text(
        yaml.safe_dump(
            {
                "tasks": {
                    "technographics": {
                        "deployment": "d.yaml",
                        "student": {"base_url": "http://student"},
                        "cloud_model": "cloud",
                    }
                },
                "api": {"url": "http://api.test", "token_file": "secrets/token"},
            }
        )
    )

    config = load_plugin_config(tmp_path / "plugin.yaml")

    assert config.api is not None
    assert config.api.token_file == tmp_path / "secrets" / "token"
