import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def compose_config() -> dict:
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
        check=True,
        text=True,
        capture_output=True,
        env={k: v for k, v in os.environ.items() if k != "DATABASE_URL"} | {"COMPOSE_DISABLE_ENV_FILE": "1"},
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


def test_production_compose_uses_legacy_defaults_without_env_file():
    config = compose_config()
    db_env = config["services"]["db"]["environment"]
    api_env = config["services"]["api"]["environment"]

    assert db_env["POSTGRES_USER"] == "rendure_user"
    assert db_env["POSTGRES_PASSWORD"] == "rendurepw@123"
    assert db_env["POSTGRES_DB"] == "rendure_db"
    assert api_env["RENDURE_API_KEY"] == "this_is_the_api_key"
    assert api_env["DATABASE_URL"] == "postgresql://rendure_user:rendurepw%40123@db:5432/rendure_db"


def test_frontend_proxy_receives_runtime_api_key():
    config = compose_config()
    frontend_env = config["services"]["frontend"]["environment"]

    assert frontend_env["RENDURE_API_KEY"] == "this_is_the_api_key"


def test_nginx_proxy_injects_api_key_header():
    template = (ROOT / "frontend" / "nginx.conf.template").read_text()

    assert 'proxy_set_header X-API-Key "${RENDURE_API_KEY}";' in template
