from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from agents.lever_portal import AgentError, run


class FakeCursor:
    def __init__(self, conn: "FakeConnection") -> None:
        self.conn = conn
        self._result = None

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params=None) -> None:
        compact_query = " ".join(query.split())
        self.conn.operations.append(("db", compact_query, params))

        if "FROM jobs j" in query:
            self._result = self.conn.job_row
        elif "FROM user_profile" in query:
            self._result = self.conn.profile_row
        elif "SELECT 1 FROM allowed_transitions" in query:
            self._result = {"exists": 1}
        else:
            self._result = None

    def fetchone(self):
        return self._result


class FakeConnection:
    def __init__(self) -> None:
        self.operations: list[tuple] = []
        self.job_row = {
            "job_id": "job-123",
            "ats_board_token": "myco",
            "ats_posting_id": "post-123",
            "jd_text": "Build backend systems.",
            "active_resume_id": "version-123",
            "status": "approved",
            "latex_source": "name: Test User",
        }
        self.profile_row = {
            "full_name": "Test User",
            "email": "test@example.com",
            "phone": "+15551234567",
            "location": "New York, NY",
            "linkedin_url": "https://linkedin.example/test",
            "github_url": "https://github.example/test",
            "portfolio_url": "https://portfolio.example",
            "salary_expectation": "$100000",
        }

    def cursor(self, *args, **kwargs) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.operations.append(("commit",))

    def rollback(self) -> None:
        self.operations.append(("rollback",))

    def close(self) -> None:
        self.operations.append(("close",))


class FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        payload: dict | None = None,
        headers: dict | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}
        self.text = str(self._payload)

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://api.lever.co")
            response = httpx.Response(
                self.status_code,
                request=request,
                text=self.text,
                headers=self.headers,
            )
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=request, response=response
            )


@pytest.fixture
def fake_conn() -> FakeConnection:
    return FakeConnection()


@pytest.fixture
def portal_mocks(monkeypatch, fake_conn, tmp_path):
    pdf_path = tmp_path / "resume.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    render_result = SimpleNamespace(path=pdf_path, bytes=b"%PDF-1.4")

    sleep = Mock()
    post = Mock(return_value=FakeResponse(200, {"applicationId": "lev-abc"}))

    monkeypatch.setattr("agents.lever_portal.psycopg2.connect", Mock(return_value=fake_conn))
    monkeypatch.setattr("agents.lever_portal.render_resume_to_pdf", Mock(return_value=render_result))
    monkeypatch.setattr("agents.lever_portal.httpx.post", post)
    monkeypatch.setattr("agents.lever_portal.time.sleep", sleep)

    return SimpleNamespace(post=post, sleep=sleep, pdf_path=pdf_path)


def _queries(conn: FakeConnection, needle: str) -> list[tuple]:
    return [
        operation
        for operation in conn.operations
        if operation[0] == "db" and needle in operation[1]
    ]


def test_lever_run_posts_to_correct_url(portal_mocks):
    run("job-123")

    assert portal_mocks.post.call_args.args[0] == (
        "https://api.lever.co/v0/postings/myco/post-123/apply"
    )


def test_lever_run_success_returns_submitted_outcome(portal_mocks):
    result = run("job-123")

    assert result == {
        "outcome": "submitted",
        "job_id": "job-123",
        "ats_type": "lever",
        "ats_application_id": "lev-abc",
    }


def test_lever_run_retries_on_429_with_retry_after_header(portal_mocks):
    portal_mocks.post.side_effect = [
        FakeResponse(429, {"error": "rate limited"}, {"Retry-After": "2"}),
        FakeResponse(200, {"applicationId": "lev-xyz"}),
    ]

    result = run("job-123")

    assert portal_mocks.post.call_count == 2
    portal_mocks.sleep.assert_called_once_with(2.0)
    assert result["ats_application_id"] == "lev-xyz"


def test_lever_run_retries_on_429_with_default_60s_when_no_retry_after_header(
    portal_mocks,
):
    portal_mocks.post.side_effect = [
        FakeResponse(429, {"error": "rate limited"}),
        FakeResponse(200, {"applicationId": "lev-xyz"}),
    ]

    run("job-123")

    assert portal_mocks.post.call_count == 2
    portal_mocks.sleep.assert_called_once_with(60)


def test_lever_run_does_not_retry_on_400(portal_mocks, fake_conn):
    portal_mocks.post.return_value = FakeResponse(400, {"error": "bad request"})

    with pytest.raises(AgentError):
        run("job-123")

    assert portal_mocks.post.call_count == 1
    assert _queries(fake_conn, "status = 'submission_failed'")


def test_lever_run_sets_status_submitting_before_post(monkeypatch, fake_conn, tmp_path):
    pdf_path = tmp_path / "resume.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")

    def post_after_submitting(*args, **kwargs):
        update_queries = _queries(fake_conn, "UPDATE jobs SET status = 'submitting'")
        assert update_queries
        return FakeResponse(200, {"applicationId": "lev-abc"})

    monkeypatch.setattr("agents.lever_portal.psycopg2.connect", Mock(return_value=fake_conn))
    monkeypatch.setattr(
        "agents.lever_portal.render_resume_to_pdf",
        Mock(return_value=SimpleNamespace(path=pdf_path, bytes=b"%PDF-1.4")),
    )
    monkeypatch.setattr("agents.lever_portal.httpx.post", Mock(side_effect=post_after_submitting))
    monkeypatch.setattr("agents.lever_portal.time.sleep", Mock())

    run("job-123")


def test_lever_run_sets_status_submitted_on_success(portal_mocks, fake_conn):
    run("job-123")

    assert _queries(fake_conn, "UPDATE jobs SET status = 'submitted'")


def test_lever_run_sets_status_submission_failed_on_http_error(portal_mocks, fake_conn):
    request = httpx.Request("POST", "https://api.lever.co")
    response = httpx.Response(500, request=request, text="server error")
    portal_mocks.post.side_effect = httpx.HTTPStatusError(
        "server error", request=request, response=response
    )

    with pytest.raises(AgentError):
        run("job-123")

    assert _queries(fake_conn, "UPDATE jobs SET status = 'submission_failed'")


def test_lever_run_deletes_temp_pdf_on_success(portal_mocks):
    assert portal_mocks.pdf_path.exists()

    run("job-123")

    assert not portal_mocks.pdf_path.exists()


def test_lever_run_deletes_temp_pdf_on_failure(portal_mocks):
    portal_mocks.post.return_value = FakeResponse(400, {"error": "bad request"})
    assert portal_mocks.pdf_path.exists()

    with pytest.raises(AgentError):
        run("job-123")

    assert not portal_mocks.pdf_path.exists()


def test_lever_run_writes_application_submissions_row(portal_mocks, fake_conn):
    run("job-123")

    inserts = _queries(fake_conn, "INSERT INTO application_submissions")
    assert inserts
    assert "lever" in inserts[0][2]
    assert "lev-abc" in inserts[0][2]
