import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def compose_config() -> dict:
    env = {
        **os.environ,
        "POSTGRES_PASSWORD": "test-postgres-password",
        "RENDURE_API_KEY": "test-api-key",
        "PROFILE_ENCRYPTION_KEY": "test-profile-encryption-key",
        "OPENROUTER_API_KEY": "test-openrouter-key",
    }
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "docker-compose.yml",
            "--profile",
            "agents",
            "config",
            "--format",
            "json",
        ],
        cwd=ROOT,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


def test_production_compose_defines_runtime_services():
    config = compose_config()

    assert {"db", "migrate", "api", "frontend", "agents"} <= set(config["services"])


def test_production_compose_keeps_database_private_and_mounts_migrations():
    config = compose_config()

    db = config["services"]["db"]
    migrate = config["services"]["migrate"]

    assert "ports" not in db
    assert any(volume["source"].endswith("/database") for volume in migrate["volumes"])


def test_production_compose_requires_runtime_secrets():
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "POSTGRES_PASSWORD",
            "RENDURE_API_KEY",
            "PROFILE_ENCRYPTION_KEY",
            "OPENROUTER_API_KEY",
        }
    }

    result = subprocess.run(
        ["docker", "compose", "-f", "docker-compose.yml", "config"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
    )

    assert result.returncode != 0
    assert "is required" in result.stderr
