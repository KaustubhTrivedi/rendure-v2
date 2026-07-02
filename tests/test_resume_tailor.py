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


def test_resume_tailor_defaults_to_empty_approved_evidence():
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    assert resume_tailor._load_approved_evidence(conn, "job-123") == []


class RecordingPromptCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def execute(self, sql, params):
        self.sql = sql
        self.params = params


def test_resume_tailor_prompt_trace_payload_is_redacted():
    cursor = RecordingPromptCursor()
    prompt = (
        "private resume: Jane Doe\n"
        "private note: do not leak\n"
        "recruiter@example.com"
    )

    resume_tailor._write_prompt_trace(cursor, "job-123", "qwen/test", 2, prompt)

    assert "llm_prompt_trace" in cursor.sql
    payload = cursor.params[-1]
    parsed = json.loads(payload)
    assert parsed["direction"] == "resume_tailor_to_llm"
    assert parsed["prompt_length"] == len(prompt)
    assert "prompt_sha256" in parsed
    assert parsed["redacted"] is True
    assert "prompt" not in parsed
    assert "Jane Doe" not in payload
    assert "do not leak" not in payload
    assert "recruiter@example.com" not in payload
import json
