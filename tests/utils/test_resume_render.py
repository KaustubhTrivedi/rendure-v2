import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from utils.resume_render import render_resume_to_pdf


def test_render_resume_raises_environment_error_when_rendercv_missing(tmp_path):
    with patch("utils.resume_render.shutil.which", return_value=None):
        with pytest.raises(EnvironmentError, match="rendercv"):
            render_resume_to_pdf("yaml content", tmp_path)


def test_render_resume_calls_subprocess_with_correct_args(tmp_path):
    captured_yaml_path = None

    def fake_run(args, **kwargs):
        nonlocal captured_yaml_path
        captured_yaml_path = Path(args[2])
        assert args[:2] == ["rendercv", "render"]
        assert captured_yaml_path.exists()
        (tmp_path / "rendered").mkdir()
        (tmp_path / "rendered" / "resume.pdf").write_bytes(b"%PDF-1.7")
        return subprocess.CompletedProcess(args=args, returncode=0)

    with patch("utils.resume_render.shutil.which", return_value="/usr/local/bin/rendercv"):
        with patch("utils.resume_render.subprocess.run", side_effect=fake_run) as run:
            render_resume_to_pdf("yaml content", tmp_path)

    assert run.call_count == 1
    assert captured_yaml_path is not None
    assert not captured_yaml_path.exists()


def test_render_resume_returns_pdf_bytes_on_success(tmp_path):
    def fake_run(args, **kwargs):
        (tmp_path / "output").mkdir()
        (tmp_path / "output" / "resume.pdf").write_bytes(b"%PDF fake bytes")
        return subprocess.CompletedProcess(args=args, returncode=0)

    with patch("utils.resume_render.shutil.which", return_value="/usr/local/bin/rendercv"):
        with patch("utils.resume_render.subprocess.run", side_effect=fake_run):
            result = render_resume_to_pdf("yaml content", tmp_path)

    assert isinstance(result, bytes)
    assert result == b"%PDF fake bytes"


def test_render_resume_raises_on_nonzero_exit(tmp_path):
    result = subprocess.CompletedProcess(
        args=["rendercv", "render", "resume.yaml"],
        returncode=1,
        stderr="error msg",
    )

    with patch("utils.resume_render.shutil.which", return_value="/usr/local/bin/rendercv"):
        with patch("utils.resume_render.subprocess.run", return_value=result):
            with pytest.raises(RuntimeError, match="rendercv.*error msg"):
                render_resume_to_pdf("yaml content", tmp_path)


def test_render_resume_deletes_temp_yaml_on_failure(tmp_path):
    captured_yaml_path = None

    def fake_run(args, **kwargs):
        nonlocal captured_yaml_path
        captured_yaml_path = Path(args[2])
        assert captured_yaml_path.exists()
        raise RuntimeError("rendercv exploded")

    with patch("utils.resume_render.shutil.which", return_value="/usr/local/bin/rendercv"):
        with patch("utils.resume_render.subprocess.run", side_effect=fake_run):
            with pytest.raises(RuntimeError, match="rendercv exploded"):
                render_resume_to_pdf("yaml content", tmp_path)

    assert captured_yaml_path is not None
    assert not captured_yaml_path.exists()
