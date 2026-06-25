from __future__ import annotations

import hashlib
from typing import Any


def build_redacted_prompt_payload(
    direction: str,
    prompt: str,
    *,
    iteration: int | None = None,
    version_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "direction": direction,
        "prompt_length": len(prompt),
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "redacted": True,
    }
    if iteration is not None:
        payload["iteration"] = iteration
    if version_id is not None:
        payload["version_id"] = version_id
    if extra:
        payload.update(extra)
    return payload
