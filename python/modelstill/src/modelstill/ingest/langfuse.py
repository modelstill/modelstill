import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Iterator, Mapping
from typing import IO, Any, Literal

from modelstill.client import Opener
from modelstill.data import TeacherOutput
from modelstill.ingest.records import Record, output_text, parse_json

BUILDER = "modelstill.ingest.langfuse"
FIELDS = "core,basic,io,model"


class LangfuseError(Exception):
    pass


def _open(request: urllib.request.Request, timeout: float) -> IO[bytes]:
    return urllib.request.urlopen(request, timeout=timeout)


class LangfuseReader:
    def __init__(
        self,
        host: str,
        public_key: str,
        secret_key: str,
        api: Literal["v1", "v2"] = "v2",
        timeout: float = 60.0,
        opener: Opener = _open,
    ) -> None:
        self._base = host.rstrip("/") + "/api/public"
        self._auth = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
        self._api = api
        self._timeout = timeout
        self._opener = opener

    def _get(self, path: str, query: Mapping[str, str | None]) -> dict[str, Any]:
        params = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        request = urllib.request.Request(
            f"{self._base}{path}?{params}",
            headers={"Authorization": f"Basic {self._auth}", "Accept": "application/json"},
            method="GET",
        )
        try:
            with self._opener(request, self._timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            raise LangfuseError(f"{error.code}: {detail}") from error

    def observations(
        self,
        start: str,
        end: str | None = None,
        kind: str = "GENERATION",
        name: str | None = None,
        page_size: int = 100,
    ) -> Iterator[dict[str, Any]]:
        query = {
            "type": kind,
            "name": name,
            "fromStartTime": start,
            "toStartTime": end,
            "limit": str(page_size),
        }
        if self._api == "v2":
            yield from self._by_cursor({**query, "fields": FIELDS})
        else:
            yield from self._by_page(query)

    def _by_cursor(self, query: Mapping[str, str | None]) -> Iterator[dict[str, Any]]:
        cursor: str | None = None
        while True:
            body = self._get("/v2/observations", {**query, "cursor": cursor})
            yield from body.get("data", [])
            cursor = (body.get("meta") or {}).get("cursor")
            if not cursor:
                return

    def _by_page(self, query: Mapping[str, str | None]) -> Iterator[dict[str, Any]]:
        page = 1
        while True:
            body = self._get("/observations", {**query, "page": str(page)})
            data = body.get("data", [])
            yield from data
            total = int((body.get("meta") or {}).get("totalPages") or 0)
            if not data or page >= total:
                return
            page += 1


def _output(row: Mapping[str, Any]) -> TeacherOutput | None:
    if row.get("level") == "ERROR":
        return TeacherOutput(error=row.get("statusMessage") or "ERROR")
    text = output_text(parse_json(row.get("output")))
    return None if text is None else TeacherOutput(text)


def records(rows: Iterable[Mapping[str, Any]]) -> Iterator[Record]:
    for row in rows:
        value = parse_json(row.get("input"))
        if value is None:
            continue
        yield Record(
            input=value,
            model=row.get("model") or f"langfuse:{row.get('name') or 'unnamed'}",
            output=_output(row),
            keys={"trace_id": str(row.get("traceId")), "observation_id": str(row["id"])},
        )
