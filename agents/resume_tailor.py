"""
Resume Tailor Agent — reads job description from DB, rewrites the resume Markdown
via LLM, commits to a git branch, and writes a resume_versions record.

Ephemeral: spawned by the Orchestrator, runs once per iteration, terminates.
Model: openrouter (no fallback — surface errors to Orchestrator).
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable

import psycopg2
from dotenv import load_dotenv

from utils.llm import load_llm
from utils.toon import toon_list, toon_table

load_dotenv()

EventCallback = Callable[[dict], None] | None

MODEL = "qwen/qwen3.5-9b"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BASE_RESUME_PATH = PROJECT_ROOT / "resume" / "resume.md"
HARD_CONSTRAINTS_PATH = PROJECT_ROOT / "profile" / "hard_constraints.md"


TAILORING_PROMPT = """\
You are a professional resume writer. Rewrite the resume below to be a strong, \
targeted match for the job description provided.

Before doing anything else, read and internalize the HARD CONSTRAINTS section below. \
These are non-negotiable rules about what you are and are not permitted to claim on \
behalf of this candidate. Violating any constraint is a critical error.

=== HARD CONSTRAINTS (read first — non-negotiable) ===
{hard_constraints}

=== JOB DESCRIPTION ===
Company: {company_name}
Role: {role_title}
Seniority: {seniority_level}

{jd_text}

=== REQUIRED SKILLS ===
{required_skills}

=== NICE-TO-HAVE SKILLS ===
{nice_to_haves}

{qa_feedback_section}

=== BASE RESUME (RenderCV YAML) ===
{base_resume}

=== TAILORING RULES ===
1. HARD CONSTRAINTS FIRST: Every output must comply with the HARD CONSTRAINTS section above. \
If a required skill or experience from the JD is not verifiably present in the hard constraints, \
omit it entirely — do NOT invent or stretch context to include it.

2. KEYWORD COVERAGE: Include every required skill that genuinely appears in the candidate's \
verified background (per the HARD CONSTRAINTS). Use the exact phrasing from the JD.

3. EXPERIENCE BULLETS: Rewrite highlights to emphasise relevance to this role. \
Lead with impact and scope. Use active verbs. Limit to 5-6 highlights per role. \
Prioritise highlights demonstrating required skills.

4. SENIORITY ALIGNMENT ({seniority_level}):
   - junior: learning velocity, contribution, foundational skills
   - mid: ownership of features, independent delivery, cross-team collaboration
   - senior: system design, technical leadership, mentoring, measurable impact
   - lead/staff: strategic direction, architectural decisions, org influence

5. SKILLS SECTION: Order required skills first, nice-to-haves second. \
Remove skills entirely unrelated to this role. \
Never add a skill listed under [DO NOT CLAIM] in the hard constraints.

6. PROFILE (if present): Rewrite to address this role directly. Mention company \
and role title. Keep to 2-3 sentences. Do not invent traits not evidenced in the CV.

7. DO NOT CHANGE: cv.name, cv.email, cv.phone, cv.location, cv.website, \
cv.social_networks, education entries, employment dates, or the top-level YAML structure. \
The design block MUST remain a top-level key (sibling of cv:, NOT nested inside cv:). \
The output must start with "cv:" and end with "design:" at the root level, like this: \
cv:\n  ...\ndesign:\n  theme: sb2nov

Return ONLY the complete rewritten resume in RenderCV YAML format. No explanations, \
no preamble, no yaml fences — just the raw YAML content starting with "cv:". \
Preserve the exact YAML structure. Do not add or remove top-level keys. \
All date fields must remain quoted strings (e.g. "2022-11"). Keep the design: block unchanged.
"""

QA_FEEDBACK_SECTION = """\
=== QA FEEDBACK FROM PREVIOUS ITERATION ===
You are retrying after a failed QA review. Address EVERY gap listed below.
For high-severity gaps, make targeted substantive changes. Do not simply rephrase.

The gaps table includes a "suggestion" column with a concrete rewrite instruction. \
Follow the suggestion for each gap precisely — it tells you exactly what to change \
and where. Do not ignore the suggestion field.

Gaps (TOON format — columns: category, severity, dimension, detail, suggestion):
{gaps_formatted}

Full QA Narrative:
{raw_feedback}
"""


class AgentError(RuntimeError):
    pass


def _get_conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _load_base_resume() -> str:
    if not BASE_RESUME_PATH.exists():
        raise AgentError(f"Base resume not found at {BASE_RESUME_PATH}")
    content = BASE_RESUME_PATH.read_text(encoding="utf-8").strip()
    if not content:
        raise AgentError(f"Base resume is empty at {BASE_RESUME_PATH}")
    return content


def _load_hard_constraints() -> str:
    if not HARD_CONSTRAINTS_PATH.exists():
        return (
            "No additional hard constraints were provided for this profile.\n"
            "Use only information already present in the base resume.\n"
            "Do not invent experience, skills, tools, metrics, dates, or credentials."
        )
    content = HARD_CONSTRAINTS_PATH.read_text(encoding="utf-8").strip()
    if not content:
        return (
            "No additional hard constraints were provided for this profile.\n"
            "Use only information already present in the base resume.\n"
            "Do not invent experience, skills, tools, metrics, dates, or credentials."
        )
    return content




def _write_error_event(conn: Any, job_id: str, error_msg: str, model: str) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = %s",
                (job_id,),
            )
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, model_used, detail, metadata)
                VALUES (%s, 'agent_error', 'resume_tailor', %s, %s, %s::jsonb)
                """,
                (job_id, model, error_msg, json.dumps({"error": error_msg})),
            )
        conn.commit()
    except Exception:
        pass


def _notify(
    event_callback: EventCallback,
    message: str,
    event: dict | None = None,
) -> None:
    """Dual-mode: always print for CLI, also call event_callback for web."""
    print(message)
    if event_callback and event:
        event_callback(event)


def run(
    job_id: str,
    version_number: int,
    iteration_number: int,
    model: str = MODEL,
    event_callback: EventCallback = None,
    profile_id: str | None = None,
) -> dict:
    """
    Tailor the resume for the given job_id.
    Returns {"outcome": "success", "job_id": job_id, "version_id": str} on success.
    Raises AgentError on failure.
    """
    conn = _get_conn()
    try:
        # ── Step 1: Read job record ───────────────────────────────────────────
        _notify(event_callback, "    Reading job description from DB...", {
            "event_type": "agent_progress", "agent_name": "resume_tailor",
            "detail": "Reading job description...",
        })
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT jd_text, required_skills, nice_to_haves,
                       seniority_level, company_name, role_title
                FROM jobs WHERE job_id = %s
                """,
                (job_id,),
            )
            job = cur.fetchone()
        if not job:
            raise AgentError(f"Job not found: {job_id}")
        _notify(event_callback, f"    Job: {job['role_title']} at {job['company_name']}", {
            "event_type": "agent_progress", "agent_name": "resume_tailor",
            "detail": f"Tailoring for {job['role_title']} at {job['company_name']}",
        })

        jd_text = job["jd_text"] or ""
        required_skills = job["required_skills"] or []
        nice_to_haves = job["nice_to_haves"] or []
        seniority_level = job["seniority_level"] or "mid"
        company_name = job["company_name"] or ""
        role_title = job["role_title"] or ""

        # ── Step 2: Read QA feedback (retry only) ────────────────────────────
        qa_feedback_section = ""
        if iteration_number > 1:
            _notify(event_callback, "    Reading QA feedback from previous iteration...", {
                "event_type": "agent_progress", "agent_name": "resume_tailor",
                "detail": "Reading QA feedback from previous iteration...",
            })
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT q.gaps, q.raw_feedback
                    FROM qa_reviews q
                    JOIN resume_versions rv ON rv.version_id = q.version_id
                    WHERE rv.job_id = %s
                    ORDER BY rv.version_number DESC
                    LIMIT 1
                    """,
                    (job_id,),
                )
                qa_row = cur.fetchone()
            if qa_row:
                gaps = qa_row["gaps"] or []
                # Backward-compat: ensure every gap dict has suggestion and dimension fields
                for gap in gaps:
                    if isinstance(gap, dict):
                        gap.setdefault("suggestion", "")
                        gap.setdefault("dimension", gap.get("category", ""))
                gaps_formatted = toon_table(
                    "gaps", ["category", "severity", "dimension", "detail", "suggestion"], gaps
                )
                qa_feedback_section = QA_FEEDBACK_SECTION.format(
                    gaps_formatted=gaps_formatted,
                    raw_feedback=qa_row["raw_feedback"] or "",
                )

        # ── Step 3: Read base resume ──────────────────────────────────────────
        if iteration_number == 1:
            _notify(event_callback, "    Reading base resume...", {
                "event_type": "agent_progress", "agent_name": "resume_tailor",
                "detail": "Reading base resume...",
            })
            base_resume = _load_base_resume()
        else:
            # On retry, read the previous version from the database
            _notify(event_callback, "    Reading previous resume version from DB...", {
                "event_type": "agent_progress", "agent_name": "resume_tailor",
                "detail": "Reading previous resume version...",
            })
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT latex_source FROM resume_versions
                    WHERE job_id = %s
                    ORDER BY version_number DESC
                    LIMIT 1
                    """,
                    (job_id,),
                )
                prev = cur.fetchone()
            if not prev or not prev[0]:
                raise AgentError(f"No previous resume version found in DB for job {job_id}")
            base_resume = prev[0]

        # ── Step 4: Rewrite via LLM ───────────────────────────────────────────
        _notify(event_callback, "    Loading hard constraints...", None)
        hard_constraints = _load_hard_constraints()

        _notify(event_callback, "    Generating tailored resume via LLM...", {
            "event_type": "agent_progress", "agent_name": "resume_tailor",
            "detail": f"Generating tailored resume (iteration {iteration_number})...",
        })
        llm = load_llm(model_name=model, temperature=0.3, max_tokens=100000, reasoning_effort="none")
        prompt = TAILORING_PROMPT.format(
            hard_constraints=hard_constraints,
            company_name=company_name,
            role_title=role_title,
            seniority_level=seniority_level,
            jd_text=jd_text[:8000],
            required_skills=toon_list("required_skills", required_skills),
            nice_to_haves=toon_list("nice_to_haves", nice_to_haves) if nice_to_haves else "(none)",
            qa_feedback_section=qa_feedback_section,
            base_resume=base_resume,
        )

        # ── Prompt trace ──────────────────────────────────────────────────────
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, model_used, detail, payload)
                VALUES (%s, 'llm_prompt_trace', 'resume_tailor', %s, %s, %s::jsonb)
                """,
                (
                    job_id,
                    model,
                    f"Tailoring prompt sent to LLM (iteration {iteration_number})",
                    json.dumps({
                        "direction": "resume_tailor→llm",
                        "iteration": iteration_number,
                        "prompt_length": len(prompt),
                        "prompt": prompt,
                    }),
                ),
            )
        conn.commit()

        tailored_resume = llm.invoke(prompt).strip()
        # Strip markdown fences if model wrapped output despite instructions
        tailored_resume = re.sub(r"^```(?:yaml)?\s*", "", tailored_resume).strip()
        tailored_resume = re.sub(r"\s*```$", "", tailored_resume).strip()

        if not tailored_resume or len(tailored_resume) < 200:
            raise AgentError("LLM returned empty or too-short resume content.")
        _notify(event_callback, f"    Resume generated ({len(tailored_resume):,} chars)", {
            "event_type": "agent_progress", "agent_name": "resume_tailor",
            "detail": f"Resume generated ({len(tailored_resume):,} chars)",
        })

        # Generate tailoring notes (brief summary)
        tailoring_notes = (
            f"Iteration {iteration_number}. Tailored for {role_title} at {company_name}. "
            f"Seniority: {seniority_level}. "
            f"Required skills targeted: {', '.join(required_skills[:5])}."
        )
        if iteration_number > 1 and qa_feedback_section:
            tailoring_notes += " QA gaps addressed from previous iteration."

        # ── Step 7: Write DB records ──────────────────────────────────────────
        version_id: str
        with conn.cursor() as cur:
            # Validate transition
            cur.execute(
                "SELECT 1 FROM allowed_transitions WHERE from_status = 'tailoring' AND to_status = 'qa_review'",
            )
            if not cur.fetchone():
                raise AgentError("Transition tailoring→qa_review not allowed.")

            # INSERT resume_versions (trigger updates iteration_count automatically)
            cur.execute(
                """
                INSERT INTO resume_versions
                    (job_id, version_number, git_branch, git_commit, latex_source, tailoring_notes)
                VALUES (%s, %s, NULL, NULL, %s, %s)
                RETURNING version_id
                """,
                (
                    job_id,
                    version_number,
                    tailored_resume,
                    tailoring_notes,
                ),
            )
            version_id = str(cur.fetchone()[0])

            # UPDATE jobs.status → qa_review
            cur.execute(
                "UPDATE jobs SET status = 'qa_review', updated_at = NOW() WHERE job_id = %s",
                (job_id,),
            )

            # INSERT pipeline_events
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, from_status, to_status, model_used, detail)
                VALUES (%s, 'status_change', 'resume_tailor', 'tailoring', 'qa_review', %s, %s)
                """,
                (
                    job_id,
                    model,
                    f"Resume tailored (iteration {iteration_number}). Version: {version_id}.",
                ),
            )

        conn.commit()
        return {"outcome": "success", "job_id": job_id, "version_id": version_id}

    except AgentError as e:
        _write_error_event(conn, job_id, str(e), model)
        raise
    except Exception as e:
        _write_error_event(conn, job_id, str(e), model)
        raise AgentError(f"resume_tailor failed: {e}") from e
    finally:
        conn.close()
