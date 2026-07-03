"""
Orchestrator Agent — the single persistent agent and sole entry point.

Controls the full pipeline:
  URL mode:      URL validation → Job Scout → Resume Tailor → QA → Confirmation
  JD-text mode:  LLM extraction from pasted JD → Resume Tailor → QA → Confirmation

Owns model fallback logic for all agents.
All user-facing messages are printed from here.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import psycopg2
import psycopg2.extras
import requests as _requests
from dotenv import load_dotenv

load_dotenv()

EventCallback = Callable[[dict], None] | None


def _notify(
    event_callback: EventCallback,
    message: str,
    event: dict | None = None,
) -> None:
    """Dual-mode: always print for CLI, also call event_callback for web."""
    print(message)
    if event_callback and event:
        event_callback(event)


_OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "qwen/qwen3-8b")

# Per-agent model defaults. Resolution order per agent:
#   MODEL_<AGENT>  →  OPENROUTER_MODEL  →  hardcoded default
_DEFAULT_AGENT_MODELS = {
    "job_scout": "google/gemini-3.1-flash-lite",
    "resume_tailor": "google/gemini-3.1-flash-lite",
    "quality_analyst": "google/gemini-3.1-flash-lite",
    "confirmation": "google/gemini-3.1-flash-lite",
    "portal_router": "google/gemini-3.1-flash-lite",
    "orchestrator": "google/gemini-3.1-flash-lite",
}

AGENT_MODELS = {
    agent: os.getenv(f"MODEL_{agent.upper()}", default)
    for agent, default in _DEFAULT_AGENT_MODELS.items()
}

FALLBACK_MODEL = os.getenv("MODEL_FALLBACK", _OPENROUTER_MODEL)

MODEL_ERROR_SIGNALS = ("API error", "timeout", "rate limit", "503", "429", "500")


def _is_model_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(s.lower() in msg for s in MODEL_ERROR_SIGNALS)


def _get_conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _log_event(
    conn: Any,
    job_id: str,
    event_type: str,
    agent_name: str,
    detail: str = "",
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
                agent_name,
                from_status,
                to_status,
                model_used,
                detail,
                json.dumps(metadata) if metadata else None,
            ),
        )
    conn.commit()


def _validate_transition(conn: Any, from_status: str, to_status: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM allowed_transitions WHERE from_status = %s AND to_status = %s",
            (from_status, to_status),
        )
        return cur.fetchone() is not None


def _set_job_status(
    conn: Any, job_id: str, new_status: str, current_status: str
) -> None:
    if not _validate_transition(conn, current_status, new_status):
        raise ValueError(f"Invalid transition: {current_status} → {new_status}")
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = %s, updated_at = NOW() WHERE job_id = %s",
            (new_status, job_id),
        )
    conn.commit()


def _poll_job_status(
    conn: Any,
    job_id: str,
    expected_statuses: list[str],
    timeout: float,
    poll_interval: float,
) -> str:
    """Poll jobs.status until it matches one of expected_statuses or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM jobs WHERE job_id = %s", (job_id,))
            row = cur.fetchone()
        if row and row[0] in expected_statuses:
            return row[0]
        time.sleep(poll_interval)
    return "timeout"


def _spawn_with_fallback(
    conn: Any,
    job_id: str,
    agent_name: str,
    agent_fn,
    kwargs: dict,
    event_callback: EventCallback = None,
) -> dict:
    """
    Run an agent function. On model error, log fallback event and retry with fallback model.
    Passes event_callback to the sub-agent for real-time progress updates.
    Raises the original exception if fallback also fails.
    """
    primary = AGENT_MODELS[agent_name]
    agent_kwargs = {**kwargs, "event_callback": event_callback}
    try:
        return agent_fn(**agent_kwargs, model=primary)
    except Exception as e:
        if _is_model_error(e):
            _log_event(
                conn,
                job_id,
                "model_fallback",
                agent_name,
                detail=f"Primary model failed. Retrying with {FALLBACK_MODEL}.",
                model_used=FALLBACK_MODEL,
                metadata={
                    "primary_model": primary,
                    "fallback_model": FALLBACK_MODEL,
                    "reason": str(e),
                },
            )
            return agent_fn(**agent_kwargs, model=FALLBACK_MODEL)
        raise


# ── JD-text extraction ───────────────────────────────────────────────────────

JD_EXTRACTION_PROMPT = """\
Extract structured information from the job description text below.

Job Description:
{jd_text}

Return ONLY a valid JSON object — no markdown fences, no explanation. Use exactly these fields:
{{
  "company_name": "<string>",
  "role_title": "<string>",
  "jd_text": "<string: concise summary of the job description — max 500 words>",
  "seniority_level": "<one of: junior, mid, senior, lead, staff, principal>",
  "location": "<string or null>",
  "required_skills": ["<skill>", ...],
  "nice_to_haves": ["<skill>", ...]
}}

Rules:
- jd_text must SUMMARISE the role overview, responsibilities, requirements, and preferred skills in under 500 words.
- Normalise skill names: "k8s" -> "Kubernetes", "postgres" -> "PostgreSQL", etc.
- required_skills: skills marked required/essential/must-have.
- nice_to_haves: skills marked preferred/bonus/nice-to-have. Empty array if none found.
- seniority_level: infer from title and JD if not stated. Default to "mid" if unclear.
- location: city/country/remote, or null if not found.
- company_name: use "Confidential" if not stated.
"""

VALID_SENIORITY = {"junior", "mid", "senior", "lead", "staff", "principal"}


def _extract_json_from_text(text: str) -> dict:
    """Extract the first JSON object from LLM output, stripping markdown fences."""
    import re

    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in LLM output: {text[:300]}")
    return json.loads(match.group())


def _process_jd_text(
    conn: Any,
    job_id: str,
    jd_text: str,
    model: str,
    event_callback: EventCallback = None,
) -> None:
    """
    Extract structured fields from a pasted JD via LLM, write them to the DB,
    and advance the job status to 'tailoring' — mirroring what job_scout does.
    """
    from utils.llm import load_llm

    _notify(
        event_callback,
        "    Extracting job details from pasted JD via LLM...",
        {
            "event_type": "agent_progress",
            "agent_name": "job_scout",
            "detail": "Extracting job details from pasted JD...",
        },
    )

    llm = load_llm(model_name=model, temperature=0.1, max_tokens=100000, reasoning_effort="none")
    prompt = JD_EXTRACTION_PROMPT.format(jd_text=jd_text[:12000])
    raw_response = llm.invoke(prompt)
    fields = _extract_json_from_text(raw_response)

    required = [
        "company_name",
        "role_title",
        "jd_text",
        "seniority_level",
        "required_skills",
    ]
    missing = [f for f in required if not fields.get(f)]
    if missing:
        raise ValueError(f"LLM extraction missing required fields: {missing}")

    seniority = fields["seniority_level"].lower().strip()
    if seniority not in VALID_SENIORITY:
        seniority = "mid"
    fields["seniority_level"] = seniority

    required_skills: list[str] = fields.get("required_skills") or []
    nice_to_haves: list[str] = fields.get("nice_to_haves") or []

    _notify(
        event_callback,
        f"    Extracted: {fields.get('role_title', '?')} at {fields.get('company_name', '?')}",
        {
            "event_type": "agent_progress",
            "agent_name": "job_scout",
            "detail": f"Found: {fields.get('role_title', '?')} at {fields.get('company_name', '?')}",
        },
    )

    with conn.cursor() as cur:
        cur.execute("SELECT git_commit FROM base_resume WHERE id = 1;")
        row = cur.fetchone()
        base_resume_ref = row[0] if row else "main"

        cur.execute(
            """
            UPDATE jobs
            SET company_name    = %s,
                role_title      = %s,
                jd_text         = %s,
                seniority_level = %s,
                location        = %s,
                required_skills = %s::jsonb,
                nice_to_haves   = %s::jsonb,
                base_resume_ref = %s,
                updated_at      = NOW()
            WHERE job_id = %s
            """,
            (
                fields["company_name"],
                fields["role_title"],
                fields["jd_text"],
                seniority,
                fields.get("location"),
                json.dumps(required_skills),
                json.dumps(nice_to_haves),
                base_resume_ref,
                job_id,
            ),
        )

        for skill in required_skills:
            cur.execute(
                "INSERT INTO job_skills (job_id, skill, required) VALUES (%s, %s, TRUE) ON CONFLICT (job_id, skill) DO NOTHING",
                (job_id, skill),
            )
        for skill in nice_to_haves:
            cur.execute(
                "INSERT INTO job_skills (job_id, skill, required) VALUES (%s, %s, FALSE) ON CONFLICT (job_id, skill) DO NOTHING",
                (job_id, skill),
            )

        cur.execute(
            "UPDATE jobs SET status = 'tailoring', updated_at = NOW() WHERE job_id = %s",
            (job_id,),
        )

        cur.execute(
            """
            INSERT INTO pipeline_events
                (job_id, event_type, agent_name, from_status, to_status, model_used, detail)
            VALUES (%s, 'status_change', 'job_scout', 'found', 'tailoring', %s, %s)
            """,
            (
                job_id,
                model,
                "Job details extracted from pasted JD. Skills written to job_skills.",
            ),
        )

    conn.commit()


def run(
    job_url: str = "",
    max_iterations: int | None = None,
    threshold: float | None = None,
    verbose: bool = False,
    poll_interval: float | None = None,
    agent_timeout: float | None = None,
    event_callback: EventCallback = None,
    jd_text: str | None = None,
    job_id: str | None = None,
    profile_id: str | None = None,
    auto_apply: bool = False,
) -> None:
    """
    Run the full Jobs Agency pipeline.

    Pass either job_url (URL mode) or jd_text (paste mode). In paste mode,
    URL validation and the Job Scout scraping step are skipped — the pasted
    text is extracted by an LLM and written directly to the DB.

    job_id: if provided, skip the INSERT and use this pre-existing record
    (web mode). If not provided, a new record is created (CLI mode).

    Prints status updates to stdout. If event_callback is provided (web mode),
    also publishes structured events for real-time SSE streaming.
    Raises on unrecoverable errors.
    """
    max_iterations = max_iterations or int(os.getenv("MAX_TAILORING_ITERATIONS", "4"))
    threshold = threshold or float(os.getenv("QA_PASS_THRESHOLD", "0.92"))
    poll_interval = poll_interval or float(os.getenv("POLL_INTERVAL_SECONDS", "5"))
    agent_timeout = agent_timeout or float(os.getenv("AGENT_TIMEOUT_SECONDS", "300"))

    use_jd_text = bool(jd_text and jd_text.strip())
    web_mode = bool(job_id)

    def mark_web_job_error(reason: str) -> None:
        if not web_mode or not job_id:
            return
        with _get_conn() as error_conn:
            with error_conn.cursor() as cur:
                cur.execute(
                    "UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = %s",
                    (job_id,),
                )
            error_conn.commit()
            _log_event(
                error_conn,
                job_id,
                "pipeline_error",
                "orchestrator",
                detail=reason,
                metadata={"reason": reason},
            )

    # In web mode the API pre-creates the job row and the worker calls this
    # function with only job_id/profile_id. Resolve the persisted job_url
    # before URL validation so the pipeline does not validate the default "".
    if job_id and not use_jd_text and not job_url:
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT job_url FROM jobs WHERE job_id = %s", (job_id,))
                row = cur.fetchone()
            if not row or not row[0]:
                raise ValueError(f"Job {job_id} has no stored job_url")
            job_url = row[0]
        finally:
            conn.close()

    label = "pasted JD" if use_jd_text else job_url

    # ── Step 1: Validate URL (URL mode only) ─────────────────────────────────
    if use_jd_text:
        _notify(
            event_callback,
            "Starting pipeline for pasted job description.",
            {
                "event_type": "pipeline_started",
                "detail": "Starting pipeline for pasted JD",
            },
        )
    else:
        _notify(
            event_callback,
            f"Starting pipeline for job at: {job_url}",
            {
                "event_type": "pipeline_started",
                "detail": f"Starting pipeline for {job_url}",
            },
        )
        try:
            head = _requests.head(job_url, allow_redirects=True, timeout=10)
            if head.status_code >= 400:
                # Some sites block HEAD; try GET
                get = _requests.get(job_url, timeout=10, stream=True)
                get.close()
                if get.status_code >= 400:
                    mark_web_job_error(f"URL unreachable (HTTP {get.status_code})")
                    _notify(
                        event_callback,
                        f"✗ URL unreachable (HTTP {get.status_code}). Pipeline not started.",
                        {
                            "event_type": "pipeline_error",
                            "detail": f"URL unreachable (HTTP {get.status_code})",
                        },
                    )
                    return
        except Exception as e:
            mark_web_job_error(f"URL validation failed: {e}")
            _notify(
                event_callback,
                f"✗ URL validation failed: {e}\nPipeline not started.",
                {
                    "event_type": "pipeline_error",
                    "detail": f"URL validation failed: {e}",
                },
            )
            return

    conn = _get_conn()

    try:
        # ── Step 2: Create or look up job record ──────────────────────────────
        with conn.cursor() as cur:
            if job_id:
                # Web mode: job already created by the API router — just use it
                cur.execute(
                    "UPDATE jobs SET status = 'found', updated_at = NOW() WHERE job_id = %s AND status = 'new'",
                    (job_id,),
                )
            elif use_jd_text:
                # CLI JD-text mode: create a new record
                job_id = str(uuid.uuid4())
                cur.execute(
                    "INSERT INTO jobs (job_id, job_url, status) VALUES (%s, %s, 'found')",
                    (job_id, ""),
                )
            else:
                # CLI URL mode: dedup by URL
                cur.execute(
                    "SELECT job_id, status FROM jobs WHERE job_url = %s", (job_url,)
                )
                existing = cur.fetchone()
                if existing:
                    job_id = str(existing[0])
                    _notify(
                        event_callback,
                        f"Existing job record found: {job_id} (status: {existing[1]})",
                        None,
                    )
                else:
                    job_id = str(uuid.uuid4())
                    cur.execute(
                        "INSERT INTO jobs (job_id, job_url, status) VALUES (%s, %s, 'found')",
                        (job_id, job_url),
                    )
        conn.commit()

        _log_event(
            conn,
            job_id,
            "pipeline_started",
            "orchestrator",
            detail=f"Pipeline started for {label}",
            from_status="new",
            to_status="found",
            model_used=AGENT_MODELS["orchestrator"],
            metadata={
                "job_url": job_url,
                "jd_text_mode": use_jd_text,
                "max_iterations": max_iterations,
                "threshold": threshold,
                "auto_apply": auto_apply,
            },
        )

        if verbose:
            _notify(event_callback, f"  job_id: {job_id}", None)

        # ── Step 3: Job Scout (URL) OR JD extraction (paste) ─────────────────
        _notify(
            event_callback,
            "  [1/4] Running Job Scout...",
            {
                "event_type": "status_change",
                "agent_name": "orchestrator",
                "detail": "Extracting job details..."
                if use_jd_text
                else "Running Job Scout...",
                "from_status": "found",
                "to_status": "tailoring",
            },
        )

        if use_jd_text:
            try:
                _process_jd_text(
                    conn,
                    job_id,
                    jd_text,
                    model=AGENT_MODELS["job_scout"],
                    event_callback=event_callback,
                )
            except Exception as e:
                _handle_agent_error(
                    conn, job_id, "job_scout", "found", str(e), event_callback
                )
                return
        else:
            from agents.job_scout import run as scout_run

            try:
                _spawn_with_fallback(
                    conn,
                    job_id,
                    "job_scout",
                    scout_run,
                    {"job_id": job_id, "job_url": job_url},
                    event_callback,
                )
            except Exception as e:
                _handle_agent_error(
                    conn, job_id, "job_scout", "found", str(e), event_callback
                )
                return

        # Poll until tailoring (agent runs synchronously, but verify DB state)
        status = _poll_job_status(
            conn, job_id, ["tailoring", "error"], agent_timeout, poll_interval
        )
        if status == "error" or status == "timeout":
            _handle_pipeline_error(
                conn,
                job_id,
                "job_scout",
                f"Job Scout ended with status: {status}",
                event_callback,
            )
            return

        # Read job_id (already have it) and job metadata for display
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT company_name, role_title FROM jobs WHERE job_id = %s", (job_id,)
            )
            job_meta = cur.fetchone()
        company = (job_meta or {}).get("company_name", "?")
        role = (job_meta or {}).get("role_title", "?")
        _notify(
            event_callback,
            f"  ✓ Job found: {role} at {company}",
            {
                "event_type": "job_found",
                "agent_name": "orchestrator",
                "detail": f"Found: {role} at {company}",
            },
        )

        # ── Steps 4–7: Resume Tailor → QA loop ───────────────────────────────
        from agents.quality_analyst import run as qa_run
        from agents.resume_tailor import run as tailor_run

        iteration = 0
        version_id: str | None = None

        while True:
            iteration += 1
            version_number = iteration

            # ── Spawn Resume Tailor ───────────────────────────────────────────
            _notify(
                event_callback,
                f"  [2/4] Running Resume Tailor (iteration {iteration})...",
                {
                    "event_type": "status_change",
                    "agent_name": "orchestrator",
                    "detail": f"Tailoring resume (iteration {iteration})...",
                },
            )
            try:
                tailor_result = _spawn_with_fallback(
                    conn,
                    job_id,
                    "resume_tailor",
                    tailor_run,
                    {
                        "job_id": job_id,
                        "version_number": version_number,
                        "iteration_number": iteration,
                        "profile_id": profile_id,
                    },
                    event_callback,
                )
                version_id = tailor_result["version_id"]
            except Exception as e:
                _handle_agent_error(
                    conn, job_id, "resume_tailor", "tailoring", str(e), event_callback
                )
                return

            status = _poll_job_status(
                conn, job_id, ["qa_review", "error"], agent_timeout, poll_interval
            )
            if status == "error" or status == "timeout":
                _handle_pipeline_error(
                    conn,
                    job_id,
                    "resume_tailor",
                    f"Resume Tailor ended with status: {status}",
                    event_callback,
                )
                return

            _notify(
                event_callback,
                f"  ✓ Resume tailored (iteration {iteration})",
                {
                    "event_type": "agent_progress",
                    "agent_name": "orchestrator",
                    "detail": f"Resume tailored (iteration {iteration})",
                },
            )

            # ── Spawn Quality Analyst ─────────────────────────────────────────
            _notify(
                event_callback,
                f"  [3/4] Running Quality Analyst (iteration {iteration})...",
                {
                    "event_type": "status_change",
                    "agent_name": "orchestrator",
                    "detail": f"Running QA review (iteration {iteration})...",
                },
            )
            try:
                qa_result = _spawn_with_fallback(
                    conn,
                    job_id,
                    "quality_analyst",
                    qa_run,
                    {
                        "job_id": job_id,
                        "version_id": version_id,
                        "iteration_number": iteration,
                    },
                    event_callback,
                )
            except Exception as e:
                _handle_agent_error(
                    conn, job_id, "quality_analyst", "qa_review", str(e), event_callback
                )
                return

            score = qa_result["score"]
            outcome = qa_result["outcome"]
            if verbose:
                _notify(
                    event_callback,
                    f"  QA score: {score:.3f} (threshold: {threshold})",
                    None,
                )

            # ── Route based on outcome ────────────────────────────────────────
            if outcome == "pass":
                _notify(
                    event_callback,
                    f"  ✓ QA passed (score: {score:.3f})",
                    {
                        "event_type": "qa_passed",
                        "agent_name": "orchestrator",
                        "detail": f"QA passed! Score: {score:.3f}",
                    },
                )
                break
            elif outcome == "fail":
                _notify(
                    event_callback,
                    f"  ↺ QA failed (score: {score:.3f}) — retrying...",
                    {
                        "event_type": "qa_failed",
                        "agent_name": "orchestrator",
                        "detail": f"QA failed (score: {score:.3f}) — retrying...",
                    },
                )
                # Reset status to tailoring for next iteration
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE jobs SET status = 'tailoring', updated_at = NOW() WHERE job_id = %s",
                        (job_id,),
                    )
                conn.commit()
                continue
            else:  # low_match
                # QA agent already set status = low_match
                _log_event(
                    conn,
                    job_id,
                    "low_match",
                    "orchestrator",
                    detail=f"Max iterations exhausted. Best score: {score:.3f}",
                    metadata={"final_score": score, "iterations": iteration},
                )
                _notify_low_match(
                    job_id,
                    role,
                    company,
                    score,
                    threshold,
                    iteration,
                    qa_result.get("gaps", []),
                    event_callback,
                )
                return

        # ── Step 8: Spawn Confirmation ────────────────────────────────────────
        _notify(
            event_callback,
            "  [4/4] Running Confirmation Agent...",
            {
                "event_type": "status_change",
                "agent_name": "orchestrator",
                "detail": "Confirming and finalizing resume...",
            },
        )
        from agents.confirmation import run as confirm_run

        try:
            payload = _spawn_with_fallback(
                conn,
                job_id,
                "confirmation",
                confirm_run,
                {"job_id": job_id},
                event_callback,
            )
        except Exception as e:
            _handle_agent_error(
                conn, job_id, "confirmation", "approved", str(e), event_callback
            )
            return

        _export_and_build_pdf(conn, payload, event_callback)
        _notify_success(payload, event_callback)

        if auto_apply:
            _notify(
                event_callback,
                "  [5/5] Running Portal Router (auto-apply)...",
                {
                    "event_type": "status_change",
                    "agent_name": "orchestrator",
                    "detail": "Running Portal Router (auto-apply)...",
                    "from_status": "approved",
                    "to_status": "submitting",
                },
            )
            from agents.portal_router import run as portal_run

            try:
                portal_result = _spawn_with_fallback(
                    conn,
                    job_id,
                    "portal_router",
                    portal_run,
                    {"job_id": job_id},
                    event_callback,
                )
                _notify_auto_apply_success(portal_result, event_callback)
            except Exception as e:
                # portal_router already set 'submission_failed'; preserve it
                # rather than forcing the job to a generic 'error' status.
                _handle_portal_failure(conn, job_id, str(e), event_callback)
                return

    except KeyboardInterrupt:
        if job_id:
            _notify(
                event_callback,
                f"\nPipeline interrupted. Job record preserved: {job_id}",
                {
                    "event_type": "pipeline_error",
                    "detail": "Pipeline interrupted by user",
                },
            )
    except Exception as e:
        if job_id:
            _handle_pipeline_error(conn, job_id, "orchestrator", str(e), event_callback)
        else:
            _notify(
                event_callback,
                f"✗ Unexpected error: {e}",
                {
                    "event_type": "pipeline_error",
                    "detail": f"Unexpected error: {e}",
                },
            )
    finally:
        conn.close()


def _handle_agent_error(
    conn: Any,
    job_id: str,
    agent_name: str,
    current_status: str,
    reason: str,
    event_callback: EventCallback = None,
) -> None:
    """Set job status to error and notify user."""
    try:
        if _validate_transition(conn, current_status, "error"):
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = %s",
                    (job_id,),
                )
            conn.commit()
        _log_event(
            conn,
            job_id,
            "pipeline_error",
            "orchestrator",
            detail=f"Agent {agent_name} failed: {reason}",
            metadata={"agent": agent_name, "reason": reason},
        )
    except Exception:
        pass

    with _get_conn() as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT company_name, role_title FROM jobs WHERE job_id = %s", (job_id,)
            )
            job = cur.fetchone() or {}

    _notify(
        event_callback,
        f"\n✗ Pipeline error\n"
        f"  Role:   {job.get('role_title', '?')} at {job.get('company_name', '?')}\n"
        f"  Job ID: {job_id}\n"
        f"  Agent:  {agent_name}\n"
        f"  Reason: {reason}\n\n"
        f"The job record has been preserved. Let me know if you want to retry.",
        {
            "event_type": "pipeline_error",
            "agent_name": agent_name,
            "detail": f"Pipeline error: {reason}",
        },
    )


def _handle_pipeline_error(
    conn: Any,
    job_id: str,
    agent_name: str,
    reason: str,
    event_callback: EventCallback = None,
) -> None:
    _handle_agent_error(conn, job_id, agent_name, "error", reason, event_callback)


def _handle_portal_failure(
    conn: Any,
    job_id: str,
    reason: str,
    event_callback: EventCallback = None,
) -> None:
    """Handle an auto-apply (portal_router) failure.

    The portal_router agent already sets ``jobs.status = 'submission_failed'``
    and records its own ``agent_error`` event before raising. This handler must
    therefore preserve that specific status — it must NOT run the generic
    ``_handle_agent_error`` path, which could transition the job to ``error``
    (overwriting ``submission_failed``) if such a transition is ever added to
    ``allowed_transitions``.
    """
    try:
        _log_event(
            conn,
            job_id,
            "application_failed",
            "portal_router",
            detail=f"Auto-apply failed: {reason}",
            metadata={"reason": reason},
        )
    except Exception:
        pass

    company = role = None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT company_name, role_title FROM jobs WHERE job_id = %s",
                (job_id,),
            )
            job = cur.fetchone() or {}
            company = job.get("company_name")
            role = job.get("role_title")
    except Exception:
        pass

    _notify(
        event_callback,
        f"\n✗ Auto-apply failed\n"
        f"  Role:   {role or '?'} at {company or '?'}\n"
        f"  Job ID: {job_id}\n"
        f"  Reason: {reason}\n\n"
        f"Your tailored resume is still available. The application was not submitted.",
        {
            "event_type": "application_failed",
            "agent_name": "portal_router",
            "detail": f"Auto-apply failed: {reason}",
        },
    )


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"


def _slugify(text: str) -> str:
    """Convert text to a filesystem-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "_", text)
    return text[:60]


def _export_and_build_pdf(
    conn: Any, payload: dict, event_callback: EventCallback = None
) -> None:
    """Export approved resume to output folder and build PDF via RenderCV Docker."""
    version_id = payload["version_id"]
    company = payload.get("company_name", "unknown")
    role = payload.get("role_title", "unknown")

    # Read resume content from DB
    with conn.cursor() as cur:
        cur.execute(
            "SELECT latex_source FROM resume_versions WHERE version_id = %s",
            (version_id,),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        _notify(
            event_callback,
            "  ⚠ Could not export resume — content not found in DB.",
            None,
        )
        return

    resume_content = row[0]

    # Create output folder: output/<company>_<role>/
    folder_name = f"{_slugify(company)}_{_slugify(role)}"
    out_dir = OUTPUT_DIR / folder_name
    out_dir.mkdir(parents=True, exist_ok=True)

    # Write resume markdown
    md_path = out_dir / "resume.md"
    md_path.write_text(resume_content, encoding="utf-8")

    # Build PDF via RenderCV in Docker
    _notify(
        event_callback,
        "  Building PDF via RenderCV...",
        {
            "event_type": "agent_progress",
            "agent_name": "orchestrator",
            "detail": "Building PDF...",
        },
    )
    try:
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{out_dir}:/resume",
                "rendercv/rendercv",
                "render",
                "/resume/resume.md",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            _notify(event_callback, f"  ✓ PDF built → {out_dir}/", None)
            payload["output_dir"] = str(out_dir)
        else:
            _notify(
                event_callback,
                f"  ⚠ RenderCV failed (exit {result.returncode}): {result.stderr[:200]}",
                None,
            )
            _notify(event_callback, f"  Resume markdown saved to: {md_path}", None)
    except FileNotFoundError:
        _notify(
            event_callback,
            f"  ⚠ Docker not found. Resume markdown saved to: {md_path}",
            None,
        )
    except subprocess.TimeoutExpired:
        _notify(
            event_callback,
            f"  ⚠ RenderCV timed out. Resume markdown saved to: {md_path}",
            None,
        )


def _notify_success(payload: dict, event_callback: EventCallback = None) -> None:
    output_line = ""
    if "output_dir" in payload:
        output_line = f"  Output:     {payload['output_dir']}\n"
    _notify(
        event_callback,
        f"\n✓ Resume ready\n"
        f"  Role:       {payload['role_title']} at {payload['company_name']}\n"
        f"  QA Score:   {payload['qa_score']:.3f} / 1.0\n"
        f"  Iterations: {payload['iteration_count']}\n"
        f"  Version:    {payload['version_id']}\n"
        f"{output_line}\n"
        f"Review the output folder and apply when ready.",
        {
            "event_type": "pipeline_complete",
            "detail": f"Resume approved! Score: {payload['qa_score']:.3f}",
        },
    )


def _notify_auto_apply_success(
    result: dict, event_callback: EventCallback = None
) -> None:
    _notify(
        event_callback,
        f"\n✓ Application submitted\n"
        f"  ATS:        {result.get('ats_type', '?')}\n"
        f"  Outcome:    {result.get('outcome', '?')}\n"
        f"  ATS ID:     {result.get('ats_application_id') or 'not provided'}",
        {
            "event_type": "application_submitted",
            "agent_name": "portal_router",
            "detail": f"Application submission outcome: {result.get('outcome', '?')}",
        },
    )


def _notify_low_match(
    job_id: str,
    role: str,
    company: str,
    score: float,
    threshold: float,
    iterations: int,
    gaps: list,
    event_callback: EventCallback = None,
) -> None:
    gaps_text = ""
    if gaps:
        high = [g for g in gaps if g.get("severity") == "high"]
        med = [g for g in gaps if g.get("severity") == "medium"]
        shown = (high + med)[:5]
        gaps_text = "\n  Gaps identified:\n"
        for g in shown:
            gaps_text += (
                f"    [{g.get('severity', '?').upper()}] {g.get('detail', '')}\n"
            )
        if len(gaps) > 5:
            gaps_text += f"    ... and {len(gaps) - 5} more gaps. See qa_reviews table for full analysis.\n"

    _notify(
        event_callback,
        f"\n⚠ Low match — flagged for review\n"
        f"  Role:         {role} at {company}\n"
        f"  Best Score:   {score:.3f} / 1.0  (threshold: {threshold})\n"
        f"  Iterations:   {iterations}"
        f"{gaps_text}\n"
        f"The resume has been saved in the database (job_id: {job_id}).\n"
        f"Review the gap analysis before deciding whether to apply.",
        {
            "event_type": "low_match",
            "detail": f"Low match: score {score:.3f} (threshold: {threshold})",
        },
    )
