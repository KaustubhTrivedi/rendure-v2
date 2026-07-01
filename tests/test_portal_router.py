from __future__ import annotations

from typing import Any
from unittest.mock import Mock, patch

import pytest

from agents.portal_router import AgentError, run
from utils.ats_detect import ATSInfo


JOB_ID = "11111111-1111-1111-1111-111111111111"
JOB_URL = "https://boards.greenhouse.io/acme/jobs/123"


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
        if "select job_url" in self.sql.lower():
            return {"job_url": JOB_URL}
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


def patch_router_boundaries(
    conn: RecordingConnection,
    *,
    ats_info: ATSInfo,
    greenhouse_result: dict[str, Any] | Exception | None = None,
    lever_result: dict[str, Any] | Exception | None = None,
    ashby_result: dict[str, Any] | Exception | None = None,
) -> Any:
    greenhouse = Mock()
    lever = Mock()
    ashby = Mock()
    for mock, result in (
        (greenhouse, greenhouse_result),
        (lever, lever_result),
        (ashby, ashby_result),
    ):
        if isinstance(result, Exception):
            mock.side_effect = result
        elif result is not None:
            mock.return_value = result
        else:
            mock.return_value = {"outcome": "submitted"}

    return (
        patch("agents.portal_router._get_conn", return_value=conn),
        patch("agents.portal_router.detect_ats", return_value=ats_info),
        patch("agents.portal_router.greenhouse_portal_run", greenhouse),
        patch("agents.portal_router.lever_portal_run", lever),
        patch("agents.portal_router.ashby_portal_run", ashby),
    )


def status_updates(conn: RecordingConnection) -> list[str]:
    return [
        params[0]
        for sql, params in conn.executions
        if sql.strip().lower().startswith("update jobs set status") and params
    ]


def ats_field_update(conn: RecordingConnection) -> tuple[Any, ...]:
    for sql, params in conn.executions:
        normalized = " ".join(sql.lower().split())
        if normalized.startswith("update jobs set ats_type"):
            assert params is not None
            return params
    raise AssertionError("ATS fields were not written to jobs")


def pipeline_event_details(conn: RecordingConnection) -> list[str]:
    return [
        str(params[2])
        for sql, params in conn.executions
        if "insert into pipeline_events" in sql.lower() and params
    ]


def test_portal_router_dispatches_to_greenhouse_when_ats_type_is_greenhouse():
    conn = RecordingConnection()
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("greenhouse", "acme", "123"),
    )

    with patches[0], patches[1], patches[2] as greenhouse, patches[3] as lever, patches[4] as ashby:
        run(JOB_ID)

    greenhouse.assert_called_once_with(job_id=JOB_ID, model="google/gemini-3.1-flash-lite", event_callback=None)
    lever.assert_not_called()
    ashby.assert_not_called()


def test_portal_router_dispatches_to_lever_when_ats_type_is_lever():
    conn = RecordingConnection()
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("lever", "acme", "123"),
    )

    with patches[0], patches[1], patches[2] as greenhouse, patches[3] as lever, patches[4] as ashby:
        run(JOB_ID)

    greenhouse.assert_not_called()
    lever.assert_called_once_with(job_id=JOB_ID, model="google/gemini-3.1-flash-lite", event_callback=None)
    ashby.assert_not_called()


def test_portal_router_dispatches_to_ashby_when_ats_type_is_ashby():
    conn = RecordingConnection()
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("ashby", "acme", "123"),
    )

    with patches[0], patches[1], patches[2] as greenhouse, patches[3] as lever, patches[4] as ashby:
        run(JOB_ID)

    greenhouse.assert_not_called()
    lever.assert_not_called()
    ashby.assert_called_once_with(job_id=JOB_ID, model="google/gemini-3.1-flash-lite", event_callback=None)


def test_portal_router_sets_submission_failed_for_unknown_ats_type():
    conn = RecordingConnection()
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("unknown", None, None),
    )

    with patches[0], patches[1], patches[2] as greenhouse, patches[3] as lever, patches[4] as ashby:
        with pytest.raises(AgentError, match="ATS not supported"):
            run(JOB_ID)

    assert status_updates(conn)[-1] == "submission_failed"
    assert any("ATS not supported" in detail for detail in pipeline_event_details(conn))
    greenhouse.assert_not_called()
    lever.assert_not_called()
    ashby.assert_not_called()


def test_portal_router_writes_ats_fields_to_jobs_before_dispatch():
    conn = RecordingConnection()
    order: list[str] = []

    def dispatch_side_effect(**kwargs: Any) -> dict[str, Any]:
        order.append("dispatch")
        assert ats_field_update(conn) == ("greenhouse", "acme", "123", JOB_ID)
        return {"outcome": "submitted"}

    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("greenhouse", "acme", "123"),
        greenhouse_result=None,
    )

    with patches[0], patches[1], patches[2] as greenhouse, patches[3], patches[4]:
        greenhouse.side_effect = dispatch_side_effect
        run(JOB_ID)

    assert order == ["dispatch"]


def test_portal_router_reads_job_url_from_db():
    conn = RecordingConnection()
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("greenhouse", "acme", "123"),
    )

    with patches[0], patches[1] as detect_ats, patches[2], patches[3], patches[4]:
        run(JOB_ID)

    detect_ats.assert_called_once_with(JOB_URL)


def test_portal_router_propagates_portal_agent_result():
    conn = RecordingConnection()
    result = {"outcome": "submitted", "ats_application_id": "gh-99"}
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("greenhouse", "acme", "123"),
        greenhouse_result=result,
    )

    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        actual = run(JOB_ID)

    assert actual == result


def test_portal_router_sets_submission_failed_when_portal_agent_raises_agent_error():
    conn = RecordingConnection()
    patches = patch_router_boundaries(
        conn,
        ats_info=ATSInfo("greenhouse", "acme", "123"),
        greenhouse_result=AgentError("some error"),
    )

    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        with pytest.raises(AgentError, match="some error"):
            run(JOB_ID)

    assert status_updates(conn)[-1] == "submission_failed"
