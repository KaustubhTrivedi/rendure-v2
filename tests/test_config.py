"""Tests for the Python DEPLOY_TARGET config module.

Tests exercise the pure resolve(env_dict) function directly (avoids
importlib.reload churn). The parity test reads the shared JSON fixture
that the TS module also asserts against (D-11 cross-language parity).
"""

import json
import os
from pathlib import Path

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "deploy-target-parity.json"


def _load_parity_fixture():
    with open(FIXTURE_PATH) as f:
        return json.load(f)


# ----- Default / self-hosted resolution -----

def test_default_target_when_depoly_target_unset():
    """resolve({}) with DATABASE_URL set -> target == 'self-hosted'."""
    from config import resolve

    result = resolve({"DATABASE_URL": "postgres://default"})
    assert result.target == "self-hosted"


def test_default_target_when_depoly_target_empty_string():
    """resolve({'DEPLOY_TARGET': ''}) with DATABASE_URL set -> target == 'self-hosted'."""
    from config import resolve

    result = resolve({"DEPLOY_TARGET": "", "DATABASE_URL": "postgres://empty"})
    assert result.target == "self-hosted"


def test_default_target_when_depoly_target_whitespace():
    """resolve({'DEPLOY_TARGET': '  '}) with DATABASE_URL set -> target == 'self-hosted'."""
    from config import resolve

    result = resolve({"DEPLOY_TARGET": "  ", "DATABASE_URL": "postgres://ws"})
    assert result.target == "self-hosted"


# ----- Parity fixture deep-equality -----

def test_parity_self_hosted():
    """resolve() for self-hosted deep-equals the shared parity fixture."""
    from config import resolve

    fixture = _load_parity_fixture()["self-hosted"]
    env = {"DEPLOY_TARGET": "self-hosted", "DATABASE_URL": "postgres://parity-fixture"}
    result = resolve(env)
    rendered = {
        "target": result.target,
        "db": dict(result.db),
        "execution": dict(result.execution),
        "credentials": dict(result.credentials),
    }
    assert rendered == fixture


def test_parity_cloud():
    """resolve() for cloud deep-equals the shared parity fixture."""
    from config import resolve

    fixture = _load_parity_fixture()["cloud"]
    env = {"DEPLOY_TARGET": "cloud"}
    result = resolve(env)
    rendered = {
        "target": result.target,
        "db": dict(result.db),
        "execution": dict(result.execution),
        "credentials": dict(result.credentials),
    }
    assert rendered == fixture


def test_parity_browser():
    """resolve() for browser deep-equals the shared parity fixture."""
    from config import resolve

    fixture = _load_parity_fixture()["browser"]
    env = {"DEPLOY_TARGET": "browser"}
    result = resolve(env)
    rendered = {
        "target": result.target,
        "db": dict(result.db),
        "execution": dict(result.execution),
        "credentials": dict(result.credentials),
    }
    assert rendered == fixture
