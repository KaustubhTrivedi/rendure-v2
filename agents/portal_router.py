"""
Portal Router Agent - detects the ATS for a job URL and dispatches to the
matching portal submission agent.

Ephemeral: spawned only after confirmation when auto-apply is explicitly enabled.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from agents.ashby_portal import run as ashby_portal_run
from agents.greenhouse_portal import run as greenhouse_portal_run
from agents.lever_portal import run as lever_portal_run
from utils.ats_detect import detect_ats

load_dotenv()

EventCallback = Callable[[dict], None] | None

MODEL = "google/gemini-3.1-flash-lite"
AGENT_NAME = "portal_router"


class AgentError(RuntimeError):
    pass


DISPATCH_TABLE = {
    "greenhouse": greenhouse_portal_run,
    "lever": lever_portal_run,
    "ashby": ashby_portal_run,
}


def _get_conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _notify(
    event_callback: EventCallback,
    message: str,
    event: dict | None = None,
) -> None:
    print(message)
    if event_callback and event:
        event_callback(event)


def _read_job_url(conn: Any, job_id: str) -> str:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT job_url FROM jobs WHERE job_id = %s", (job_id,))
        row = cur.fetchone()

    if not row:
        raise AgentError(f"No job found for job_id: {job_id}")

    job_url = row["job_url"] if isinstance(row, dict) else row[0]
    if not job_url:
        raise AgentError(f"Job {job_id} has no job_url")
    return str(job_url)


def _write_ats_fields(
    conn: Any,
    *,
    job_id: str,
    ats_type: str,
    board_token: str | None,
    posting_id: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
            SET ats_type = %s,
                ats_board_token = %s,
                ats_posting_id = %s,
                updated_at = NOW()
            WHERE job_id = %s
            """,
            (ats_type, board_token, posting_id, job_id),
        )
    conn.commit()


def _set_submission_failed(conn: Any, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = %s, updated_at = NOW() WHERE job_id = %s",
            ("submission_failed", job_id),
        )
    conn.commit()


def _log_event(
    conn: Any,
    *,
    job_id: str,
    event_type: str,
    detail: str,
    model: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO pipeline_events
                (job_id, event_type, detail, agent_name, model_used, metadata)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                job_id,
                event_type,
                detail,
                AGENT_NAME,
                model,
                json.dumps(metadata) if metadata else None,
            ),
        )
    conn.commit()


def _fail_submission(
    conn: Any,
    *,
    job_id: str,
    detail: str,
    model: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    _set_submission_failed(conn, job_id)
    _log_event(
        conn,
        job_id=job_id,
        event_type="agent_error",
        detail=detail,
        model=model,
        metadata=metadata,
    )


def _dispatch_table() -> dict[str, Callable[..., dict]]:
    return {
        "greenhouse": greenhouse_portal_run,
        "lever": lever_portal_run,
        "ashby": ashby_portal_run,
    }


def run(job_id: str, model: str = MODEL, event_callback: EventCallback = None) -> dict:
    conn = _get_conn()
    try:
        _notify(
            event_callback,
            "    Detecting ATS portal...",
            {
                "event_type": "agent_progress",
                "agent_name": AGENT_NAME,
                "detail": "Detecting ATS portal...",
            },
        )

        job_url = _read_job_url(conn, job_id)
        ats_info = detect_ats(job_url)
        _write_ats_fields(
            conn,
            job_id=job_id,
            ats_type=ats_info.ats_type,
            board_token=ats_info.board_token,
            posting_id=ats_info.posting_id,
        )

        if ats_info.ats_type == "unknown":
            detail = (
                "ATS not supported - URL did not match Greenhouse, Lever, or "
                f"Ashby patterns. URL: {job_url[:200]}"
            )
            _fail_submission(
                conn,
                job_id=job_id,
                detail=detail,
                model=model,
                metadata={"ats_type": ats_info.ats_type, "job_url": job_url[:200]},
            )
            raise AgentError(detail)

        portal_fn = _dispatch_table().get(ats_info.ats_type)
        if portal_fn is None:
            detail = f"ATS not supported - detected unsupported ats_type: {ats_info.ats_type}"
            _fail_submission(
                conn,
                job_id=job_id,
                detail=detail,
                model=model,
                metadata={"ats_type": ats_info.ats_type},
            )
            raise AgentError(detail)

        _notify(
            event_callback,
            f"    Dispatching to {ats_info.ats_type} portal agent...",
            {
                "event_type": "agent_progress",
                "agent_name": AGENT_NAME,
                "detail": f"Dispatching to {ats_info.ats_type} portal agent...",
            },
        )

        try:
            return portal_fn(job_id=job_id, model=model, event_callback=event_callback)
        except Exception as exc:
            _fail_submission(
                conn,
                job_id=job_id,
                detail=f"Portal agent failed: {exc}",
                model=model,
                metadata={"ats_type": ats_info.ats_type, "reason": str(exc)},
            )
            raise

    except AgentError:
        raise
    except Exception as exc:
        raise AgentError(f"portal_router failed: {exc}") from exc
    finally:
        conn.close()
