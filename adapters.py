from __future__ import annotations

import os
from typing import Any

import psycopg2

from config import config


def get_connection() -> Any:
    conn_str = config.db.get("connectionString")
    if not conn_str:
        raise RuntimeError(
            f"get_connection(): config.db['connectionString'] not set "
            f"for DEPLOY_TARGET={config.target!r}"
        )
    return psycopg2.connect(conn_str)


def get_llm_credentials(
    *,
    provider: str | None = None,
    codex_auth_file_path: str | None = None,
) -> dict[str, str | None]:
    creds: dict[str, str | None] = {
        "openrouter_api_key": os.environ.get("OPENROUTER_API_KEY"),
        "codex_access_token": None,
        "codex_account_id": None,
    }

    resolved_provider = provider or os.environ.get("LLM_PROVIDER")
    if resolved_provider != "codex-oauth":
        return creds
    if codex_auth_file_path is not None and not os.path.exists(codex_auth_file_path):
        return creds
    try:
        from utils.llm import _CodexTokenManager

        access_token, account_id = _CodexTokenManager(codex_auth_file_path).ensure_valid()
        creds["codex_access_token"] = access_token
        creds["codex_account_id"] = account_id
    except Exception:
        pass

    return creds
