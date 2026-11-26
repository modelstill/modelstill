import pytest


@pytest.fixture(autouse=True)
def no_api_from_the_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MODELSTILL_API_URL", raising=False)
    monkeypatch.delenv("MODELSTILL_API_TOKEN", raising=False)
