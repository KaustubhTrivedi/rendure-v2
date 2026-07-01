"""
Lever Portal Agent - submits approved applications to Lever's public Postings API.

Ephemeral: spawned only after confirmation and explicit auto-apply opt-in.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from utils.resume_render import render_resume_to_pdf

load_dotenv()

EventCallback = Callable[[dict], None] | None

LEVER_APPLY_URL = "https://api.lever.co/v0/postings/{company}/{posting_id}/apply"
MODEL = "google/gemini-3.1-flash-lite"
DEFAULT_RETRY_AFTER = 60
MAX_RETRY_AFTER = 120
TRANSIENT_RETRY_AFTER = 5


class AgentError(RuntimeError):
    pass


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


def run(job_id: str, model: str = MODEL, event_callback: EventCallback = None) -> dict:
    conn = _get_conn()
    pdf_path: Path | None = None
    context: dict[str, Any] | None = None

    try:
        context = _load_context(conn, job_id)
        _set_status(conn, job_id, "approved", "submitting", model)
        _notify(
            event_callback,
            "    Submitting application to Lever...",
            {
                "event_type": "agent_progress",
                "agent_name": "lever_portal",
                "detail": "Submitting application to Lever...",
            },
        )

        pdf_bytes, pdf_path = _render_pdf(context["latex_source"])
        response = _post_with_retry(context, pdf_bytes)
        response_json = response.json()
        ats_application_id = response_json.get("applicationId")

        _insert_submission(
            conn,
            job_id=job_id,
            version_id=context["active_resume_id"],
            status="submitted",
            ats_application_id=ats_application_id,
            error_detail=None,
            metadata=response_json,
        )
        _set_status(conn, job_id, "submitting", "submitted", model)
        _log_event(
            conn,
            job_id=job_id,
            event_type="agent_complete",
            from_status="submitting",
            to_status="submitted",
            model=model,
            detail="Lever application submitted.",
            metadata={
                "ats_type": "lever",
                "ats_application_id": ats_application_id,
            },
        )
        conn.commit()

        return {
            "outcome": "submitted",
            "job_id": job_id,
            "ats_type": "lever",
            "ats_application_id": ats_application_id,
        }

    except AgentError as exc:
        _mark_failed(conn, job_id, model, context, str(exc))
        raise
    except EnvironmentError as exc:
        _mark_failed(conn, job_id, model, context, str(exc))
        raise AgentError(f"lever_portal failed: {exc}") from exc
    except Exception as exc:
        _mark_failed(conn, job_id, model, context, str(exc))
        raise AgentError(f"lever_portal failed: {exc}") from exc
    finally:
        if pdf_path is not None:
            pdf_path.unlink(missing_ok=True)
        conn.close()


def _load_context(conn: Any, job_id: str) -> dict[str, Any]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT j.job_id, j.ats_board_token, j.ats_posting_id, j.jd_text,
                   j.active_resume_id, j.status, rv.latex_source
            FROM jobs j
            JOIN resume_versions rv ON rv.version_id = j.active_resume_id
            WHERE j.job_id = %s
            """,
            (job_id,),
        )
        job_row = cur.fetchone()

    if not job_row:
        raise AgentError(f"No approved Lever job found for job_id: {job_id}")
    if job_row["status"] != "approved":
        raise AgentError(
            f"Lever pre-condition failure: jobs.status is '{job_row['status']}', expected 'approved'"
        )
    if not job_row["ats_board_token"] or not job_row["ats_posting_id"]:
        raise AgentError("Lever pre-condition failure: missing ats_board_token or ats_posting_id")
    if not job_row["active_resume_id"]:
        raise AgentError("Lever pre-condition failure: jobs.active_resume_id is NULL")

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT full_name, email, phone, location, linkedin_url, github_url,
                   portfolio_url, salary_expectation
            FROM user_profile
            WHERE id = 1
            """,
        )
        profile_row = cur.fetchone()

    if not profile_row:
        raise AgentError("Lever pre-condition failure: user_profile id=1 not found")
    if not profile_row["full_name"] or not profile_row["email"]:
        raise AgentError("Lever pre-condition failure: full_name and email are required")

    context = dict(job_row)
    context.update({"profile": dict(profile_row)})
    return context


def _render_pdf(yaml_content: str) -> tuple[bytes, Path | None]:
    rendered = render_resume_to_pdf(yaml_content=yaml_content)
    if isinstance(rendered, bytes):
        return rendered, None

    pdf_bytes = getattr(rendered, "bytes", None)
    pdf_path = getattr(rendered, "path", None)
    if pdf_bytes is None and pdf_path is not None:
        pdf_bytes = Path(pdf_path).read_bytes()
    if pdf_bytes is None:
        raise AgentError("render_resume_to_pdf returned no PDF bytes")
    return pdf_bytes, Path(pdf_path) if pdf_path is not None else None


def _post_with_retry(context: dict[str, Any], pdf_bytes: bytes) -> httpx.Response:
    url = LEVER_APPLY_URL.format(
        company=context["ats_board_token"],
        posting_id=context["ats_posting_id"],
    )
    profile = context["profile"]
    data = {
        "name": profile["full_name"],
        "email": profile["email"],
        "phone": profile.get("phone") or "",
        "location": profile.get("location") or "",
        "urls[LinkedIn]": profile.get("linkedin_url") or "",
        "urls[GitHub]": profile.get("github_url") or "",
        "urls[Portfolio]": profile.get("portfolio_url") or "",
        "comments": "",
    }
    files = {
        "resume": ("resume.pdf", pdf_bytes, "application/pdf"),
    }

    response = _post_once(url, data, files)
    if response.status_code == 429:
        retry_after = _parse_retry_after(response.headers.get("Retry-After"))
        time.sleep(retry_after)
        response = _post_once(url, data, files)
    elif response.status_code >= 500:
        time.sleep(TRANSIENT_RETRY_AFTER)
        response = _post_once(url, data, files)

    if response.status_code == 400:
        raise AgentError(f"Lever rejected application: {_error_detail(response)}")

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        detail = exc.response.text if exc.response is not None else str(exc)
        raise AgentError(f"Lever HTTP error {status_code}: {detail[:500]}") from exc

    return response


def _post_once(url: str, data: dict[str, Any], files: dict[str, Any]) -> httpx.Response:
    try:
        return httpx.post(url, data=data, files=files, timeout=30)
    except httpx.HTTPStatusError:
        raise
    except httpx.HTTPError as exc:
        raise AgentError(f"Lever HTTP request failed: {str(exc)[:500]}") from exc


def _parse_retry_after(value: str | None) -> float | int:
    if value is None:
        return DEFAULT_RETRY_AFTER
    try:
        return min(float(value), float(MAX_RETRY_AFTER))
    except ValueError:
        return DEFAULT_RETRY_AFTER


def _error_detail(response: httpx.Response) -> str:
    return (response.text or f"HTTP {response.status_code}")[:500]


def _set_status(
    conn: Any,
    job_id: str,
    from_status: str,
    to_status: str,
    model: str,
) -> None:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT 1 FROM allowed_transitions WHERE from_status = %s AND to_status = %s",
            (from_status, to_status),
        )
        if not cur.fetchone():
            raise AgentError(f"Transition {from_status}->{to_status} not allowed")
        cur.execute(
            "UPDATE jobs SET status = %s, updated_at = NOW() WHERE job_id = %s",
            (to_status, job_id),
        )
        cur.execute(
            """
            INSERT INTO pipeline_events
                (job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata)
            VALUES (%s, 'status_change', 'lever_portal', %s, %s, %s, %s, %s::jsonb)
            """,
            (
                job_id,
                from_status,
                to_status,
                model,
                f"Lever portal status changed from {from_status} to {to_status}.",
                json.dumps({"ats_type": "lever"}),
            ),
        )
    conn.commit()


def _insert_submission(
    conn: Any,
    *,
    job_id: str,
    version_id: str,
    status: str,
    ats_application_id: str | None,
    error_detail: str | None,
    metadata: dict[str, Any],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO application_submissions
                (job_id, version_id, ats_type, ats_application_id, status, error_detail, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                job_id,
                version_id,
                "lever",
                ats_application_id,
                status,
                error_detail[:500] if error_detail else None,
                json.dumps(metadata),
            ),
        )


def _mark_failed(
    conn: Any,
    job_id: str,
    model: str,
    context: dict[str, Any] | None,
    detail: str,
) -> None:
    try:
        if context is not None:
            _insert_submission(
                conn,
                job_id=job_id,
                version_id=context["active_resume_id"],
                status="failed",
                ats_application_id=None,
                error_detail=detail,
                metadata={"ats_type": "lever"},
            )
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET status = 'submission_failed', updated_at = NOW() WHERE job_id = %s",
                (job_id,),
            )
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata)
                VALUES (%s, 'agent_error', 'lever_portal', 'submitting', 'submission_failed', %s, %s, %s::jsonb)
                """,
                (
                    job_id,
                    model,
                    detail[:500],
                    json.dumps({"ats_type": "lever", "error_detail": detail[:500]}),
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()


def _log_event(
    conn: Any,
    *,
    job_id: str,
    event_type: str,
    from_status: str,
    to_status: str,
    model: str,
    detail: str,
    metadata: dict[str, Any],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO pipeline_events
                (job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata)
            VALUES (%s, %s, 'lever_portal', %s, %s, %s, %s, %s::jsonb)
            """,
            (
                job_id,
                event_type,
                from_status,
                to_status,
                model,
                detail,
                json.dumps(metadata),
            ),
        )
