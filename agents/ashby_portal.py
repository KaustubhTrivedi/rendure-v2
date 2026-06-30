"""
Ashby Portal Agent — submits an approved tailored resume through Ashby's
applicationForm.submit endpoint.

Ephemeral: spawned only after confirmation when auto-apply is explicitly enabled.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from utils.resume_render import render_resume_to_pdf

load_dotenv()

EventCallback = Callable[[dict], None] | None

ASHBY_SUBMIT_URL = "https://api.ashbyhq.com/applicationForm.submit"
MODEL = "google/gemini-3.1-flash-lite"
AGENT_NAME = "ashby_portal"


class AgentError(RuntimeError):
    pass


def _get_conn() -> Any:
    return psycopg2.connect(os.environ.get("DATABASE_URL", ""))


def _notify(
    event_callback: EventCallback,
    message: str,
    event: dict | None = None,
) -> None:
    """Dual-mode: always print for CLI, also call event_callback for web."""
    print(message)
    if event_callback and event:
        event_callback(event)


def _validate_transition(conn: Any, from_status: str, to_status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM allowed_transitions WHERE from_status = %s AND to_status = %s",
            (from_status, to_status),
        )
        if cur.fetchone() is None:
            raise AgentError(f"Invalid transition: {from_status} -> {to_status}")


def _set_job_status(conn: Any, job_id: str, new_status: str, current_status: str) -> None:
    _validate_transition(conn, current_status, new_status)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = %s, updated_at = NOW() WHERE job_id = %s",
            (new_status, job_id),
        )
    conn.commit()


def _log_event(
    conn: Any,
    job_id: str,
    event_type: str,
    detail: str,
    *,
    from_status: str | None = None,
    to_status: str | None = None,
    model_used: str | None = None,
    metadata: dict | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO pipeline_events
                (job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                job_id,
                event_type,
                AGENT_NAME,
                from_status,
                to_status,
                model_used,
                detail,
                json.dumps(metadata) if metadata else None,
            ),
        )
    conn.commit()


def _write_submission(
    conn: Any,
    *,
    job_id: str,
    version_id: str,
    ats_application_id: str | None,
    status: str,
    error_detail: str | None = None,
    metadata: dict | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO application_submissions
                (submission_id, job_id, version_id, ats_type, ats_application_id, status, error_detail, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                str(uuid4()),
                job_id,
                version_id,
                "ashby",
                ats_application_id,
                status,
                error_detail[:500] if error_detail else None,
                json.dumps(metadata) if metadata else None,
            ),
        )
    conn.commit()


def _read_application_inputs(conn: Any, job_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT j.job_id, j.ats_board_token, j.ats_posting_id, j.jd_text,
                   j.status, j.active_resume_id,
                   rv.version_id, rv.latex_source
            FROM jobs j
            JOIN resume_versions rv ON rv.version_id = j.active_resume_id
            WHERE j.job_id = %s
            """,
            (job_id,),
        )
        job = cur.fetchone()

        cur.execute(
            """
            SELECT full_name, email, phone, location, linkedin_url, github_url,
                   portfolio_url, salary_expectation
            FROM user_profile
            WHERE id = 1
            """,
            (),
        )
        profile = cur.fetchone()

    if not job:
        raise AgentError(f"No approved job/resume found for job_id: {job_id}")
    if not profile:
        raise AgentError("No user_profile row found for id=1")
    if not job.get("ats_board_token") or not job.get("ats_posting_id"):
        raise AgentError("Ashby organization slug or posting id is missing")
    if not job.get("active_resume_id") or not job.get("latex_source"):
        raise AgentError("Approved resume version is missing")
    if not profile.get("full_name") or not profile.get("email"):
        raise AgentError("User profile full_name and email are required")
    return dict(job), dict(profile)


def _split_name(full_name: str) -> tuple[str, str]:
    parts = full_name.split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _coerce_pdf_result(result: Any) -> tuple[bytes, Path | None]:
    if isinstance(result, tuple):
        pdf_bytes, temp_path = result
        return bytes(pdf_bytes), Path(temp_path)
    if hasattr(result, "bytes"):
        temp_path = Path(result.path) if getattr(result, "path", None) else None
        return bytes(result.bytes), temp_path
    return bytes(result), None


def _delete_temp_pdf(temp_pdf_path: Path | None) -> None:
    if temp_pdf_path is not None:
        temp_pdf_path.unlink(missing_ok=True)


def _build_multipart(
    *,
    job: dict[str, Any],
    profile: dict[str, Any],
    pdf_bytes: bytes,
) -> dict[str, Any]:
    first_name, last_name = _split_name(str(profile["full_name"]))
    fields: dict[str, Any] = {
        "jobPostingId": str(job["ats_posting_id"]),
        "organizationHostedJobsPageName": str(job["ats_board_token"]),
        "firstName": first_name,
        "lastName": last_name,
        "email": str(profile["email"]),
        "phoneNumber": str(profile.get("phone") or ""),
        "location": str(profile.get("location") or ""),
        # Ashby's public docs do not conclusively confirm this file field name.
        # "_systemfield_resume" is the commonly documented default for v1.
        "_systemfield_resume": ("resume.pdf", pdf_bytes, "application/pdf"),
    }
    optional_fields = {
        "linkedInUrl": profile.get("linkedin_url"),
        "githubUrl": profile.get("github_url"),
        "websiteUrl": profile.get("portfolio_url"),
        "salaryExpectation": profile.get("salary_expectation"),
    }
    for key, value in optional_fields.items():
        if value:
            fields[key] = str(value)
    return fields


def _post_application(multipart: dict[str, Any]) -> httpx.Response:
    response = httpx.post(ASHBY_SUBMIT_URL, files=multipart, timeout=30)
    if response.status_code >= 500:
        time.sleep(5)
        response = httpx.post(ASHBY_SUBMIT_URL, files=multipart, timeout=30)
    response.raise_for_status()
    return response


def _ashby_error_detail(response_json: dict[str, Any]) -> str:
    errors = response_json.get("errors") or []
    if not isinstance(errors, list):
        errors = [errors]
    error_detail = "; ".join(str(error) for error in errors[:5])
    return error_detail or "Ashby rejected submission - success:false"


def run(job_id: str, model: str = MODEL, event_callback: EventCallback = None) -> dict:
    """
    Submit the approved tailored resume for an Ashby-hosted job.
    Returns a submission payload on success and raises AgentError on failure.
    """
    conn = _get_conn()
    temp_pdf_path: Path | None = None
    version_id = ""

    try:
        _notify(
            event_callback,
            "    Preparing Ashby application submission...",
            {
                "event_type": "agent_progress",
                "agent_name": AGENT_NAME,
                "detail": "Preparing Ashby application submission...",
            },
        )

        job, profile = _read_application_inputs(conn, job_id)
        version_id = str(job["active_resume_id"])
        current_status = str(job["status"])
        _set_job_status(conn, job_id, "submitting", current_status)

        try:
            pdf_bytes, temp_pdf_path = _coerce_pdf_result(
                render_resume_to_pdf(yaml_content=job["latex_source"], tmp_dir=None)
            )
        except EnvironmentError as exc:
            detail = str(exc)
            _set_job_status(conn, job_id, "submission_failed", "submitting")
            _write_submission(
                conn,
                job_id=job_id,
                version_id=version_id,
                ats_application_id=None,
                status="failed",
                error_detail=detail,
            )
            _log_event(
                conn,
                job_id,
                "agent_error",
                detail,
                from_status="submitting",
                to_status="submission_failed",
                model_used=model,
                metadata={"error": detail},
            )
            raise AgentError(f"ashby_portal failed: {detail}") from exc

        response = _post_application(
            _build_multipart(job=job, profile=profile, pdf_bytes=pdf_bytes)
        )
        response_json = response.json()
        if response_json.get("success") is not True:
            error_detail = _ashby_error_detail(response_json)
            _set_job_status(conn, job_id, "submission_failed", "submitting")
            _write_submission(
                conn,
                job_id=job_id,
                version_id=version_id,
                ats_application_id=None,
                status="failed",
                error_detail=error_detail,
                metadata={"response": str(response_json)[:500]},
            )
            _log_event(
                conn,
                job_id,
                "agent_error",
                error_detail,
                from_status="submitting",
                to_status="submission_failed",
                model_used=model,
                metadata={"errors": response_json.get("errors") or []},
            )
            raise AgentError(f"Ashby submission rejected: {error_detail}")

        ats_application_id = str(
            response_json.get("applicationId") or response_json.get("id") or ""
        )
        _set_job_status(conn, job_id, "submitted", "submitting")
        _write_submission(
            conn,
            job_id=job_id,
            version_id=version_id,
            ats_application_id=ats_application_id,
            status="submitted",
            metadata={"response": str(response_json)[:500]},
        )
        result = {
            "outcome": "submitted",
            "job_id": job_id,
            "ats_type": "ashby",
            "ats_application_id": ats_application_id,
        }
        _log_event(
            conn,
            job_id,
            "agent_complete",
            "Ashby application submitted.",
            from_status="submitting",
            to_status="submitted",
            model_used=model,
            metadata=result,
        )
        return result

    except AgentError:
        raise
    except Exception as exc:
        detail = str(exc)
        if version_id:
            try:
                _set_job_status(conn, job_id, "submission_failed", "submitting")
                _write_submission(
                    conn,
                    job_id=job_id,
                    version_id=version_id,
                    ats_application_id=None,
                    status="failed",
                    error_detail=detail,
                )
                _log_event(
                    conn,
                    job_id,
                    "agent_error",
                    detail[:500],
                    from_status="submitting",
                    to_status="submission_failed",
                    model_used=model,
                    metadata={"error": detail[:500]},
                )
            except Exception:
                pass
        raise AgentError(f"ashby_portal failed: {detail}") from exc
    finally:
        _delete_temp_pdf(temp_pdf_path)
        conn.close()
