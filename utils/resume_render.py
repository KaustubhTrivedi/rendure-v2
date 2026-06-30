from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def render_resume_to_pdf(yaml_content: str, tmp_dir: Path | str | None = None) -> bytes:
    if shutil.which("rendercv") is None:
        raise EnvironmentError(
            "rendercv not found on PATH. Ensure the project virtualenv is active - "
            "rendercv[full] is already in pyproject.toml and should be at .venv/bin/rendercv."
        )

    owns_tmp_dir = tmp_dir is None
    work_dir = Path(tempfile.mkdtemp(prefix="rendercv-")) if owns_tmp_dir else Path(tmp_dir)
    if owns_tmp_dir:
        work_dir.chmod(0o700)
    else:
        work_dir.mkdir(parents=True, exist_ok=True)

    fd, yaml_name = tempfile.mkstemp(suffix=".yaml", dir=work_dir)
    os.close(fd)
    yaml_path = Path(yaml_name)

    try:
        yaml_path.write_text(yaml_content, encoding="utf-8")
        result = subprocess.run(
            ["rendercv", "render", str(yaml_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"rendercv failed: {result.stderr[:500]}")

        pdf_path = _find_rendered_pdf(work_dir)
        return pdf_path.read_bytes()
    finally:
        yaml_path.unlink(missing_ok=True)
        if owns_tmp_dir:
            shutil.rmtree(work_dir, ignore_errors=True)


def _find_rendered_pdf(work_dir: Path) -> Path:
    pdf_paths = sorted(work_dir.rglob("*.pdf"))
    if not pdf_paths:
        raise RuntimeError("rendercv failed: no PDF output found")
    return pdf_paths[0]
