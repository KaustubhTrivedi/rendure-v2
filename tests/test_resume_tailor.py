from pathlib import Path

import agents.resume_tailor as resume_tailor


def test_resume_tailor_reads_first_iteration_base_resume_from_resume_file(tmp_path, monkeypatch):
    resume_dir = tmp_path / "resume"
    resume_dir.mkdir()
    resume_path = resume_dir / "resume.md"
    resume_path.write_text("cv:\n  name: Test Candidate\n\ndesign:\n  theme: sb2nov\n", encoding="utf-8")
    monkeypatch.setattr(resume_tailor, "BASE_RESUME_PATH", resume_path)

    assert resume_tailor._load_base_resume() == "cv:\n  name: Test Candidate\n\ndesign:\n  theme: sb2nov"


def test_resume_tailor_reports_missing_base_resume_path(tmp_path, monkeypatch):
    missing_path = tmp_path / "resume" / "resume.md"
    monkeypatch.setattr(resume_tailor, "BASE_RESUME_PATH", missing_path)

    try:
        resume_tailor._load_base_resume()
    except resume_tailor.AgentError as exc:
        assert str(missing_path) in str(exc)
    else:
        raise AssertionError("expected AgentError for missing base resume")
