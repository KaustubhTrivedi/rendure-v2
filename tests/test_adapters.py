"""Tests for adapters.py — get_connection() and get_llm_credentials()."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


AUTH_TOKENS = {
    "access_token": "token-test",
    "refresh_token": "refresh-test",
    "account_id": "acct-test",
}


def _write_auth_file(path: Path) -> None:
    path.write_text(json.dumps({"tokens": AUTH_TOKENS}))


def test_get_connection_calls_psycopg2_with_config_connection_string():
    from adapters import get_connection

    mock_config = MagicMock()
    mock_config.db.get.return_value = "postgres://test"
    mock_config.target = "self-hosted"

    with patch("adapters.config", mock_config), patch("adapters.psycopg2.connect") as mock_connect:
        get_connection()

    mock_config.db.get.assert_called_once_with("connectionString")
    mock_connect.assert_called_once_with("postgres://test")


def test_get_connection_raises_when_connection_string_missing():
    from adapters import get_connection

    mock_config = MagicMock()
    mock_config.db.get.return_value = None
    mock_config.target = "self-hosted"

    with patch("adapters.config", mock_config):
        with pytest.raises(RuntimeError, match=r"config\.db\['connectionString'\] not set"):
            get_connection()


def test_get_llm_credentials_returns_openrouter_key_without_jina_key():
    from adapters import get_llm_credentials

    with patch.dict(
        os.environ,
        {
            "OPENROUTER_API_KEY": "sk-test",
            "JINA_API_KEY": "jina-should-not-be-returned",
        },
        clear=False,
    ):
        creds = get_llm_credentials()

    assert creds == {
        "openrouter_api_key": "sk-test",
        "codex_access_token": None,
        "codex_account_id": None,
    }
    assert "JINA_API_KEY" not in creds


def test_get_llm_credentials_returns_none_when_openrouter_key_absent(monkeypatch: pytest.MonkeyPatch):
    from adapters import get_llm_credentials

    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    creds = get_llm_credentials()

    assert creds["openrouter_api_key"] is None
    assert creds["codex_access_token"] is None
    assert creds["codex_account_id"] is None


def test_get_llm_credentials_reads_codex_tokens_from_auth_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from adapters import get_llm_credentials

    auth_file = tmp_path / "auth.json"
    _write_auth_file(auth_file)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    creds = get_llm_credentials(
        provider="codex-oauth",
        codex_auth_file_path=str(auth_file),
    )

    assert creds == {
        "openrouter_api_key": None,
        "codex_access_token": "token-test",
        "codex_account_id": "acct-test",
    }


def test_get_llm_credentials_returns_none_for_missing_codex_auth_file(tmp_path: Path):
    from adapters import get_llm_credentials

    missing_path = tmp_path / "missing-auth.json"
    creds = get_llm_credentials(
        provider="codex-oauth",
        codex_auth_file_path=str(missing_path),
    )

    assert creds["codex_access_token"] is None
    assert creds["codex_account_id"] is None


def test_get_llm_credentials_leaves_codex_values_none_for_other_providers(tmp_path: Path):
    from adapters import get_llm_credentials

    auth_file = tmp_path / "auth.json"
    _write_auth_file(auth_file)
    creds = get_llm_credentials(
        provider="openrouter",
        codex_auth_file_path=str(auth_file),
    )

    assert creds["codex_access_token"] is None
    assert creds["codex_account_id"] is None
