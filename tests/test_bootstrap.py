import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_bootstrap_dry_run_creates_env_and_prints_local_url(tmp_path):
    result = subprocess.run(
        ["bash", str(ROOT / "scripts" / "bootstrap.sh"), "--dry-run"],
        cwd=tmp_path,
        check=True,
        text=True,
        capture_output=True,
    )

    env_file = tmp_path / ".env"
    assert env_file.exists()

    env_text = env_file.read_text()
    assert "POSTGRES_USER=rendure_user" in env_text
    assert "POSTGRES_PASSWORD=" in env_text
    assert "RENDURE_API_KEY=" in env_text
    assert "PROFILE_ENCRYPTION_KEY=" in env_text
    assert "OPENROUTER_API_KEY=" in env_text
    assert "HTTP_PORT=8080" in env_text
    assert "changeme" not in env_text

    assert "http://localhost:8080" in result.stdout
    assert "docker compose up -d --build" in result.stdout


def test_readme_includes_one_command_bootstrap():
    readme = (ROOT / "README.md").read_text()

    assert "curl -fsSL https://raw.githubusercontent.com/KaustubhTrivedi/rendure-v2/main/scripts/bootstrap.sh | bash" in readme
