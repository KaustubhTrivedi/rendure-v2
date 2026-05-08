"""
Confirmation Agent — final agent in the pipeline. Reads the approved job record,
verifies pre-conditions, assembles a completion payload, and signals the Orchestrator.

Ephemeral: spawned only after QA pass, terminates after writing pipeline_events.
Model: openrouter (lightweight verification task).
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

EventCallback = Callable[[dict], None] | None

MODEL = "openrouter"


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


def run(job_id: str, model: str = MODEL, event_callback: EventCallback = None) -> dict:
    """
    Verify the approved job record and assemble a completion payload.
    Returns the payload dict on success.
    Raises AgentError if pre-conditions fail.
    """
    conn = _get_conn()
    try:
        # ── Step 1: Read job + resume_versions ───────────────────────────────
        _notify(event_callback, "    Verifying pre-conditions...", {
            "event_type": "agent_progress", "agent_name": "confirmation",
            "detail": "Verifying pre-conditions...",
        })
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT j.job_id, j.company_name, j.role_title, j.qa_score,
                       j.active_resume_id, j.iteration_count, j.status,
                       rv.version_number, rv.version_id
                FROM jobs j
                JOIN resume_versions rv ON rv.version_id = j.active_resume_id
                WHERE j.job_id = %s
                """,
                (job_id,),
            )
            row = cur.fetchone()

        if not row:
            raise AgentError(f"No approved record found for job_id: {job_id}")

        # ── Step 2: Verify pre-conditions ─────────────────────────────────────
        errors = []
        if row["status"] != "approved":
            errors.append(f"jobs.status is '{row['status']}', expected 'approved'")
        if not row["active_resume_id"]:
            errors.append("jobs.active_resume_id is NULL")
        qa_score = float(row["qa_score"]) if row["qa_score"] is not None else None
        if qa_score is None or not (0.0 <= qa_score <= 1.0):
            errors.append(f"jobs.qa_score is invalid: {qa_score}")

        if errors:
            raise AgentError(f"Confirmation pre-condition failure: {'; '.join(errors)}")

        # ── Step 3: Assemble completion payload ───────────────────────────────
        payload = {
            "outcome": "confirmed",
            "job_id": str(row["job_id"]),
            "company_name": row["company_name"],
            "role_title": row["role_title"],
            "qa_score": qa_score,
            "version_id": str(row["version_id"]),
            "version_number": row["version_number"],
            "iteration_count": row["iteration_count"],
        }

        # ── Step 5: Write pipeline_events ─────────────────────────────────────
        detail = (
            f"Resume confirmed ready. "
            f"QA score: {qa_score:.3f}. Iterations: {row['iteration_count']}."
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, from_status, to_status, model_used, detail, metadata)
                VALUES (%s, 'agent_complete', 'confirmation', 'approved', 'approved', %s, %s, %s::jsonb)
                """,
                (job_id, model, detail, json.dumps(payload)),
            )
        conn.commit()

        return payload

    except AgentError:
        raise
    except Exception as e:
        raise AgentError(f"confirmation failed: {e}") from e
    finally:
        conn.close()
