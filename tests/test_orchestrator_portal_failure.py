from __future__ import annotations

from typing import Any

from agents.orchestrator import _handle_portal_failure


JOB_ID = "22222222-2222-2222-2222-222222222222"


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
        if "company_name" in self.sql.lower():
            return {"company_name": "Acme", "role_title": "Staff Engineer"}
        return None


class RecordingConnection:
    def __init__(self) -> None:
        self.executions: list[tuple[str, tuple[Any, ...] | None]] = []
        self.commits = 0

    def cursor(self, *args: Any, **kwargs: Any) -> RecordingCursor:
        return RecordingCursor(self)

    def commit(self) -> None:
        self.commits += 1


def test_portal_failure_does_not_overwrite_status_to_error() -> None:
    conn = RecordingConnection()

    _handle_portal_failure(conn, JOB_ID, "portal boom")

    # The portal agent already set 'submission_failed'; the orchestrator must not
    # issue an UPDATE that forces the job back to a generic 'error' status.
    for sql, params in conn.executions:
        assert "UPDATE jobs SET status = 'error'" not in sql
        if "update jobs set status" in sql.lower():
            assert params is not None
            assert "error" not in [str(p) for p in params]


def test_portal_failure_never_validates_a_submitting_to_error_transition() -> None:
    conn = RecordingConnection()

    _handle_portal_failure(conn, JOB_ID, "portal boom")

    for sql, _ in conn.executions:
        assert "allowed_transitions" not in sql.lower()


def test_portal_failure_notifies_via_event_callback() -> None:
    conn = RecordingConnection()
    events: list[dict] = []

    _handle_portal_failure(conn, JOB_ID, "portal boom", events.append)

    assert len(events) == 1
    assert events[0]["agent_name"] == "portal_router"
    assert "portal boom" in events[0]["detail"]
