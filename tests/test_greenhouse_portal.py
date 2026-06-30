from __future__ import annotations

from contextlib import ExitStack, contextmanager
from typing import Any
from unittest.mock import Mock, patch

import httpx
import pytest

from agents.greenhouse_portal import AgentError, run


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
        self.conn.executions.append((sql, params))

    def fetchone(self) -> Any:
        sql = self.sql.lower()
        if "from jobs j" in sql and "join resume_versions" in sql:
            return {
                "job_id": JOB_ID,
                "ats_board_token": "acme",
                "ats_posting_id": "12345",
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
        self.executions: list[tuple[str, tuple[Any, ...] | None]] = []
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
                request=httpx.Request("POST", "https://example.test"),
                response=httpx.Response(self.status_code),
            )


@contextmanager
def patch_boundaries(
    conn: RecordingConnection,
    *,
    get_response: JsonResponse | None = None,
    post_side_effect: Any = None,
    pdf_bytes: bytes = b"PDF",
) -> Any:
    get_response = get_response or JsonResponse(
        {
            "questions": [
                {
                    "label": "authorized to work",
                    "required": True,
                    "fields": [{"name": "q_auth"}],
                }
            ]
        }
    )
    post_response = post_side_effect or JsonResponse(
        {"id": "cand-123", "application": {"id": "app-456"}}
    )
    post_mock = Mock()
    if isinstance(post_response, list):
        post_mock.side_effect = post_response
    elif isinstance(post_response, BaseException):
        post_mock.side_effect = post_response
    else:
        post_mock.return_value = post_response

    mocks = {
        "_get_conn": Mock(return_value=conn),
        "render_resume_to_pdf": Mock(return_value=pdf_bytes),
        "httpx": Mock(get=Mock(return_value=get_response), post=post_mock),
        "sleep": Mock(),
    }
    with ExitStack() as stack:
        for name, mock in mocks.items():
            stack.enter_context(patch(f"agents.greenhouse_portal.{name}", mock))
        yield mocks


def status_updates(conn: RecordingConnection) -> list[str]:
    return [
        params[0]
        for sql, params in conn.executions
        if sql.strip().lower().startswith("update jobs set status") and params
    ]


def submission_params(conn: RecordingConnection) -> tuple[Any, ...]:
    for sql, params in conn.executions:
        if "insert into application_submissions" in sql.lower():
            assert params is not None
            return params
    raise AssertionError("application_submissions insert was not executed")


def test_greenhouse_run_fetches_questions_and_posts_application():
    conn = RecordingConnection()

    with patch_boundaries(conn) as mocks:
        result = run(JOB_ID)

    mocks["httpx"].get.assert_called_once()
    assert "boards-api.greenhouse.io/v1/boards/acme/jobs/12345" in str(
        mocks["httpx"].get.call_args.args[0]
    )
    mocks["httpx"].post.assert_called_once()
    post_kwargs = mocks["httpx"].post.call_args.kwargs
    assert post_kwargs["files"]["resume"] == ("resume.pdf", b"PDF", "application/pdf")
    assert post_kwargs["data"]["first_name"] == "Test"
    assert post_kwargs["data"]["last_name"] == "Candidate"
    assert post_kwargs["data"]["q_auth"] == "Yes"
    assert result["outcome"] == "submitted"
    assert result["ats_application_id"] == "app-456"


def test_greenhouse_run_detects_silent_accept_failure():
    conn = RecordingConnection()

    with patch_boundaries(conn, post_side_effect=JsonResponse({"status": "ok"})):
        with pytest.raises(AgentError, match="silent"):
            run(JOB_ID)

    assert submission_params(conn)[3] == "greenhouse"
    assert submission_params(conn)[5] == "failed"
    assert status_updates(conn)[-1] == "submission_failed"


def test_greenhouse_run_retries_on_5xx():
    conn = RecordingConnection()
    responses = [
        JsonResponse({"error": "temporarily unavailable"}, status_code=500),
        JsonResponse({"id": "c1", "application": {"id": "a1"}}),
    ]

    with patch_boundaries(conn, post_side_effect=responses) as mocks:
        result = run(JOB_ID)

    assert mocks["httpx"].post.call_count == 2
    mocks["sleep"].assert_called_once_with(5)
    assert result["outcome"] == "submitted"
    assert result["ats_application_id"] == "a1"


def test_greenhouse_run_sets_status_submitting_before_post():
    conn = RecordingConnection()

    with patch_boundaries(conn) as mocks:
        run(JOB_ID)

    first_status_index = next(
        i
        for i, (sql, _) in enumerate(conn.executions)
        if sql.strip().lower().startswith("update jobs set status")
    )
    post_happened_after_status = mocks["httpx"].post.call_count == 1
    assert post_happened_after_status
    assert status_updates(conn)[0] == "submitting"
    assert first_status_index < len(conn.executions)


def test_greenhouse_run_sets_status_submitted_on_success():
    conn = RecordingConnection()

    with patch_boundaries(conn):
        run(JOB_ID)

    assert status_updates(conn)[-1] == "submitted"


def test_greenhouse_run_sets_status_submission_failed_on_error():
    conn = RecordingConnection()

    with patch_boundaries(conn, post_side_effect=httpx.HTTPError("network down")):
        with pytest.raises(AgentError):
            run(JOB_ID)

    assert status_updates(conn)[-1] == "submission_failed"


def test_greenhouse_run_deletes_temp_pdf_on_success(tmp_path):
    conn = RecordingConnection()
    pdf_path = tmp_path / "resume.pdf"
    pdf_path.write_bytes(b"PDF")

    with patch_boundaries(conn) as mocks:
        mocks["render_resume_to_pdf"].return_value = (b"PDF", pdf_path)
        run(JOB_ID)

    assert not pdf_path.exists()


def test_greenhouse_run_deletes_temp_pdf_on_failure(tmp_path):
    conn = RecordingConnection()
    pdf_path = tmp_path / "resume.pdf"
    pdf_path.write_bytes(b"PDF")

    with patch_boundaries(conn, post_side_effect=httpx.HTTPError("network down")) as mocks:
        mocks["render_resume_to_pdf"].return_value = (b"PDF", pdf_path)
        with pytest.raises(AgentError):
            run(JOB_ID)

    assert not pdf_path.exists()


def test_greenhouse_run_writes_application_submissions_row():
    conn = RecordingConnection()

    with patch_boundaries(conn):
        run(JOB_ID)

    params = submission_params(conn)
    assert params[1] == JOB_ID
    assert params[2] == VERSION_ID
    assert params[3] == "greenhouse"
    assert params[4] == "app-456"
    assert params[5] == "submitted"


def test_greenhouse_run_raises_environment_error_when_rendercv_missing():
    conn = RecordingConnection()

    with patch_boundaries(conn) as mocks:
        mocks["render_resume_to_pdf"].side_effect = EnvironmentError("rendercv missing")
        with pytest.raises(AgentError, match="rendercv"):
            run(JOB_ID)

    assert status_updates(conn)[-1] == "submission_failed"
    assert submission_params(conn)[5] == "failed"
