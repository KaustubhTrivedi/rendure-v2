from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import httpx
import pytest

from agents.ashby_portal import AgentError, run


JOB_ID = "11111111-1111-1111-1111-111111111111"
VERSION_ID = "22222222-2222-2222-2222-222222222222"


class RecordingCursor:
    def __init__(self, conn: "RecordingConnection") -> None:
        self.conn = conn
        self.sql = ""
        self.params: tuple[Any, ...] | None = None

    def __enter__(self) -> "RecordingCursor":
        return self

    def __exit__(self, *args: Any) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> None:
        self.sql = sql
        self.params = params
        self.conn.executions.append(("db", " ".join(sql.split()), params))

    def fetchone(self) -> Any:
        sql = self.sql.lower()
        if "from jobs j" in sql and "join resume_versions" in sql:
            return {
                "job_id": JOB_ID,
                "ats_board_token": "acme",
                "ats_posting_id": "posting-123",
                "jd_text": "Python engineer role",
                "status": "approved",
                "active_resume_id": VERSION_ID,
                "version_id": VERSION_ID,
                "latex_source": "name: Test Candidate",
            }
        if "from user_profile" in sql:
            return {
                "full_name": "Test Candidate",
                "email": "test@example.com",
                "phone": "555-0100",
                "location": "Dublin",
                "linkedin_url": "https://linkedin.example/test",
                "github_url": "https://github.example/test",
                "portfolio_url": "https://portfolio.example",
                "salary_expectation": "Negotiable",
            }
        if "from allowed_transitions" in sql:
            return (1,)
        return None


class RecordingConnection:
    def __init__(self) -> None:
        self.executions: list[tuple[str, str | None, tuple[Any, ...] | None]] = []
        self.commits = 0
        self.closed = False

    def cursor(self, *args: Any, **kwargs: Any) -> RecordingCursor:
        return RecordingCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        self.closed = True


class JsonResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=httpx.Request(
                    "POST", "https://api.ashbyhq.com/applicationForm.submit"
                ),
                response=httpx.Response(self.status_code),
            )


@pytest.fixture
def fake_conn() -> RecordingConnection:
    return RecordingConnection()


@pytest.fixture
def portal_mocks(monkeypatch, fake_conn, tmp_path) -> SimpleNamespace:
    pdf_path = tmp_path / "resume.pdf"
    pdf_path.write_bytes(b"%PDF-1.7")
    render_result = SimpleNamespace(path=pdf_path, bytes=b"%PDF-1.7")
    post = Mock(return_value=JsonResponse({"success": True, "applicationId": "ash-123"}))
    sleep = Mock()

    monkeypatch.setattr("agents.ashby_portal.psycopg2.connect", Mock(return_value=fake_conn))
    monkeypatch.setattr(
        "agents.ashby_portal.render_resume_to_pdf",
        Mock(return_value=render_result),
    )
    monkeypatch.setattr("agents.ashby_portal.httpx.post", post)
    monkeypatch.setattr("agents.ashby_portal.time.sleep", sleep)

    return SimpleNamespace(post=post, sleep=sleep, pdf_path=pdf_path)


def _queries(conn: RecordingConnection, needle: str) -> list[tuple]:
    return [
        operation
        for operation in conn.executions
        if operation[0] == "db" and needle in operation[1]
    ]


def _status_updates(conn: RecordingConnection) -> list[str]:
    return [
        params[0]
        for _, sql, params in conn.executions
        if sql and sql.lower().startswith("update jobs set status") and params
    ]


def _submission_params(conn: RecordingConnection) -> tuple[Any, ...]:
    for _, sql, params in conn.executions:
        if sql and "insert into application_submissions" in sql.lower():
            assert params is not None
            return params
    raise AssertionError("application_submissions insert was not executed")


def test_ashby_run_posts_to_correct_endpoint(portal_mocks):
    run(JOB_ID)

    assert portal_mocks.post.call_args.args[0] == (
        "https://api.ashbyhq.com/applicationForm.submit"
    )


def test_ashby_run_success_checks_success_field_not_http_status(portal_mocks):
    portal_mocks.post.return_value = JsonResponse(
        {"success": True, "applicationId": "ash-ok"},
        status_code=200,
    )

    result = run(JOB_ID)

    assert result["outcome"] == "submitted"
    assert result["ats_application_id"] == "ash-ok"


def test_ashby_run_http_200_with_success_false_is_a_failure(portal_mocks, fake_conn):
    portal_mocks.post.return_value = JsonResponse(
        {"success": False, "errors": ["First name is required", "Email is required"]},
        status_code=200,
    )

    with pytest.raises(AgentError, match="First name is required"):
        run(JOB_ID)

    assert _status_updates(fake_conn)[-1] == "submission_failed"
    params = _submission_params(fake_conn)
    assert params[5] == "failed"
    assert "First name is required" in params[6]


def test_ashby_run_http_200_with_success_false_missing_errors_key(portal_mocks):
    portal_mocks.post.return_value = JsonResponse({"success": False}, status_code=200)

    with pytest.raises(AgentError, match="success:false"):
        run(JOB_ID)


def test_ashby_run_retries_on_5xx(portal_mocks):
    portal_mocks.post.side_effect = [
        JsonResponse({"success": False, "errors": ["temporary"]}, status_code=500),
        JsonResponse({"success": True, "applicationId": "ash-retry"}),
    ]

    result = run(JOB_ID)

    assert portal_mocks.post.call_count == 2
    portal_mocks.sleep.assert_called_once_with(5)
    assert result["ats_application_id"] == "ash-retry"


def test_ashby_run_sets_status_submitting_before_post(monkeypatch, fake_conn, tmp_path):
    pdf_path = tmp_path / "resume.pdf"
    pdf_path.write_bytes(b"%PDF-1.7")

    def post_after_submitting(*args, **kwargs):
        assert "submitting" in _status_updates(fake_conn)
        return JsonResponse({"success": True, "applicationId": "ash-123"})

    monkeypatch.setattr("agents.ashby_portal.psycopg2.connect", Mock(return_value=fake_conn))
    monkeypatch.setattr(
        "agents.ashby_portal.render_resume_to_pdf",
        Mock(return_value=SimpleNamespace(path=pdf_path, bytes=b"%PDF-1.7")),
    )
    monkeypatch.setattr("agents.ashby_portal.httpx.post", Mock(side_effect=post_after_submitting))
    monkeypatch.setattr("agents.ashby_portal.time.sleep", Mock())

    run(JOB_ID)


def test_ashby_run_sets_status_submitted_on_success(portal_mocks, fake_conn):
    run(JOB_ID)

    assert _status_updates(fake_conn)[-1] == "submitted"


def test_ashby_run_sets_status_submission_failed_on_success_false(
    portal_mocks,
    fake_conn,
):
    portal_mocks.post.return_value = JsonResponse(
        {"success": False, "errors": ["missing required field"]},
        status_code=200,
    )

    with pytest.raises(AgentError):
        run(JOB_ID)

    assert _status_updates(fake_conn)[-1] == "submission_failed"


def test_ashby_run_deletes_temp_pdf_on_success(portal_mocks):
    assert portal_mocks.pdf_path.exists()

    run(JOB_ID)

    assert not portal_mocks.pdf_path.exists()


def test_ashby_run_deletes_temp_pdf_on_failure(portal_mocks):
    portal_mocks.post.return_value = JsonResponse(
        {"success": False, "errors": ["missing required field"]},
        status_code=200,
    )
    assert portal_mocks.pdf_path.exists()

    with pytest.raises(AgentError):
        run(JOB_ID)

    assert not portal_mocks.pdf_path.exists()


def test_ashby_run_writes_application_submissions_row_on_success(portal_mocks, fake_conn):
    run(JOB_ID)

    params = _submission_params(fake_conn)
    assert params[1] == JOB_ID
    assert params[2] == VERSION_ID
    assert params[3] == "ashby"
    assert params[4] == "ash-123"
    assert params[5] == "submitted"


def test_ashby_run_writes_application_submissions_row_on_failure(portal_mocks, fake_conn):
    portal_mocks.post.return_value = JsonResponse(
        {"success": False, "errors": ["First name is required", "Email is required"]},
        status_code=200,
    )

    with pytest.raises(AgentError):
        run(JOB_ID)

    params = _submission_params(fake_conn)
    assert params[3] == "ashby"
    assert params[5] == "failed"
    assert "Email is required" in params[6]
