import argparse
import hashlib
import json
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

Responder = Callable[[dict[str, Any]], str]


def empty_technologies(body: dict[str, Any]) -> str:
    return '{"technologies": []}'


def _logprobs(body: dict[str, Any], tokens: int = 8) -> list[dict[str, Any]]:
    digest = hashlib.sha256(json.dumps(body.get("messages"), sort_keys=True).encode()).digest()
    return [
        {"token": f"t{index}", "logprob": -(digest[index] / 255) * 0.6, "top_logprobs": []}
        for index in range(tokens)
    ]


def make_handler(
    model: str, responder: Responder, seen: list[dict[str, Any]]
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def _send(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            self._send(200, {"object": "list", "data": [{"id": model, "object": "model"}]})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            seen.append(body)
            choice: dict[str, Any] = {
                "index": 0,
                "message": {"role": "assistant", "content": responder(body)},
                "finish_reason": "stop",
            }
            if body.get("logprobs"):
                choice["logprobs"] = {"content": _logprobs(body)}
            self._send(
                200,
                {
                    "id": "chatcmpl-fake",
                    "object": "chat.completion",
                    "created": 0,
                    "model": model,
                    "choices": [choice],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
                },
            )

    return Handler


class FakeOpenAI:
    def __init__(self, model: str, responder: Responder = empty_technologies) -> None:
        self.requests: list[dict[str, Any]] = []
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), make_handler(model, responder, self.requests)
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __enter__(self) -> "FakeOpenAI":
        self.thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.server.shutdown()
        self.server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="A tiny OpenAI-compatible chat server for tests and local end-to-end runs."
    )
    parser.add_argument("--port", type=int, default=18001)
    parser.add_argument("--model", default="technographics-v1-s1")
    args = parser.parse_args()
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port), make_handler(args.model, empty_technologies, [])
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
