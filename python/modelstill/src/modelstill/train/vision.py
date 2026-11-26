import base64
from typing import Any

from modelstill.train import ChatRow, ImagePart, Message

__all__ = ["decode_image", "vision_record"]

_DATA_URL = "data:"


def decode_image(url: str) -> bytes:
    if not url.startswith(_DATA_URL) or ";base64," not in url:
        raise ValueError("images must be embedded as data:<type>;base64,<data> URLs")
    return base64.b64decode(url.split(";base64,", 1)[1])


def _parts(message: Message, images: list[bytes]) -> dict[str, Any]:
    if isinstance(message.content, str):
        return {"role": message.role, "content": [{"type": "text", "text": message.content}]}
    parts: list[dict[str, Any]] = []
    for part in message.content:
        if isinstance(part, ImagePart):
            images.append(decode_image(part.image))
            parts.append({"type": "image"})
        else:
            parts.append({"type": "text", "text": part.text})
    return {"role": message.role, "content": parts}


def vision_record(row: ChatRow) -> dict[str, Any]:
    images: list[bytes] = []
    messages = [_parts(message, images) for message in row.messages]
    return {"prompt": messages[:-1], "completion": messages[-1:], "images": images}
