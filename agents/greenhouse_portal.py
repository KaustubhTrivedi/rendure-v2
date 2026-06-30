"""
Greenhouse Portal Agent — submits an approved tailored resume through the
Greenhouse public Board API.

Ephemeral: spawned only after confirmation when auto-apply is explicitly enabled.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from time import sleep
from typing import Any, Callable
from uuid import uuid4

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from utils.answer_engine import AnswerEngine
from utils.resume_render import render_resume_to_pdf

load_dotenv()

EventCallback = Callable[[dict], None] | None

GREENHOUSE_JOBS_URL = "https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}"
GREENHOUSE_APPLY_URL = "https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}"
MODEL = "google/gemini-3.1-flash-lite"
AGENT_NAME = "greenhouse_portal"


class AgentError(RuntimeError):
    pass


def _get_conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])


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
                "greenhouse",
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
        raise AgentError("Greenhouse board token or posting id is missing")
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
    return parts[0], parts[-1]


def _coerce_pdf_result(result: Any) -> tuple[bytes, Path | None]:
    if isinstance(result, tuple):
        pdf_bytes, temp_path = result
        return bytes(pdf_bytes), Path(temp_path)
    return bytes(result), None


def _delete_temp_pdf(temp_pdf_path: Path | None) -> None:
    if temp_pdf_path is not None:
        temp_pdf_path.unlink(missing_ok=True)


def _fetch_questions(token: str, posting_id: str) -> list[dict[str, Any]]:
    url = GREENHOUSE_JOBS_URL.format(token=token, job_id=posting_id)
    response = httpx.get(url, timeout=30)
    response.raise_for_status()
    questions = response.json().get("questions") or []
    if not isinstance(questions, list):
        return []
    return questions


def _answer_questions(
    questions: list[dict[str, Any]],
    *,
    resume_content: str,
    jd_text: str,
    model: str,
) -> dict[str, str]:
    engine = AnswerEngine(model_name=model)
    answers: dict[str, str] = {}
    for question in questions:
        label = str(question.get("label") or "")
        fields = question.get("fields") or []
        if not label or not fields:
            continue
        field_name = fields[0].get("name") if isinstance(fields[0], dict) else None
        if not field_name:
            continue
        answers[str(field_name)] = engine.lookup(
            question=label,
            resume_content=resume_content,
            jd_text=jd_text,
        )
    return answers


def _post_application(
    *,
    token: str,
    posting_id: str,
    form_data: dict[str, str],
    pdf_bytes: bytes,
) -> httpx.Response:
    url = GREENHOUSE_APPLY_URL.format(token=token, job_id=posting_id)
    files = {"resume": ("resume.pdf", pdf_bytes, "application/pdf")}
    response = httpx.post(url, data=form_data, files=files, timeout=30)
    if response.status_code >= 500:
        sleep(5)
        response = httpx.post(url, data=form_data, files=files, timeout=30)
    response.raise_for_status()
    return response


def run(job_id: str, model: str = MODEL, event_callback: EventCallback = None) -> dict:
    """
    Submit the approved tailored resume for a Greenhouse-hosted job.
    Returns a submission payload on success and raises AgentError on failure.
    """
    conn = _get_conn()
    temp_pdf_path: Path | None = None
    job: dict[str, Any] = {}
    version_id = ""

    try:
        _notify(
            event_callback,
            "    Preparing Greenhouse application submission...",
            {
                "event_type": "agent_progress",
                "agent_name": AGENT_NAME,
                "detail": "Preparing Greenhouse application submission...",
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
            raise AgentError(f"greenhouse_portal failed: {detail}") from exc

        questions = _fetch_questions(str(job["ats_board_token"]), str(job["ats_posting_id"]))
        answers = _answer_questions(
            questions,
            resume_content=str(job["latex_source"]),
            jd_text=str(job.get("jd_text") or ""),
            model=model,
        )

        first_name, last_name = _split_name(str(profile["full_name"]))
        form_data = {
            "first_name": first_name,
            "last_name": last_name,
            "email": str(profile["email"]),
            "phone": str(profile.get("phone") or ""),
            **answers,
        }

        response = _post_application(
            token=str(job["ats_board_token"]),
            posting_id=str(job["ats_posting_id"]),
            form_data=form_data,
            pdf_bytes=pdf_bytes,
        )
        payload = response.json()
        candidate_id = payload.get("id")
        if not candidate_id:
            detail = "Greenhouse silent-accept: response contained no candidate id"
            _set_job_status(conn, job_id, "submission_failed", "submitting")
            _write_submission(
                conn,
                job_id=job_id,
                version_id=version_id,
                ats_application_id=None,
                status="failed",
                error_detail=detail,
                metadata={"response": str(payload)[:500]},
            )
            _log_event(
                conn,
                job_id,
                "agent_error",
                detail,
                from_status="submitting",
                to_status="submission_failed",
                model_used=model,
                metadata={"reason": "silent_accept"},
            )
            raise AgentError("Greenhouse silent-accept failure - no candidate id in response")

        application = payload.get("application") or {}
        ats_application_id = str(application.get("id") or candidate_id)
        _set_job_status(conn, job_id, "submitted", "submitting")
        _write_submission(
            conn,
            job_id=job_id,
            version_id=version_id,
            ats_application_id=ats_application_id,
            status="submitted",
            metadata={"candidate_id": str(candidate_id)},
        )
        result = {
            "outcome": "submitted",
            "job_id": job_id,
            "ats_type": "greenhouse",
            "ats_application_id": ats_application_id,
        }
        _log_event(
            conn,
            job_id,
            "agent_complete",
            "Greenhouse application submitted.",
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
        raise AgentError(f"greenhouse_portal failed: {detail}") from exc
    finally:
        _delete_temp_pdf(temp_pdf_path)
        conn.close()
