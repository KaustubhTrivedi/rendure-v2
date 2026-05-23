from unittest.mock import MagicMock

import agents.resume_tailor as resume_tailor


def test_resume_tailor_loads_base_resume_from_profile():
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = ("cv:\n  name: Test Candidate\n\ndesign:\n  theme: sb2nov\n",)

    result = resume_tailor._load_base_resume_from_profile(conn)

    assert result == "cv:\n  name: Test Candidate\n\ndesign:\n  theme: sb2nov"


def test_resume_tailor_reports_missing_profile_resume():
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = None

    try:
        resume_tailor._load_base_resume_from_profile(conn)
    except resume_tailor.AgentError as exc:
        assert "No resume found" in str(exc)
    else:
        raise AssertionError("expected AgentError for missing profile resume")
