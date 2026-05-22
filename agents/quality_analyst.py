"""
Quality Analyst Agent — evaluates a tailored resume against the job description
across 4 dimensions, computes a composite score, and writes a qa_reviews record.

Ephemeral: spawned by the Orchestrator, runs once per iteration, terminates.
Model: openrouter (no fallback — surface errors to Orchestrator).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from utils.llm import extract_json, load_llm
from utils.toon import parse_toon_table, toon_list

load_dotenv()

EventCallback = Callable[[dict], None] | None

MODEL = "anthropic/claude-sonnet-4.6"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HARD_CONSTRAINTS_PATH = PROJECT_ROOT / "profile" / "hard_constraints.md"


def _load_hard_constraints() -> str:
    """Load the candidate hard constraints. Returns empty string if missing (non-fatal for QA)."""
    if not HARD_CONSTRAINTS_PATH.exists():
        return ""
    content = HARD_CONSTRAINTS_PATH.read_text(encoding="utf-8").strip()
    return content


def _get_hard_constraints(conn: Any) -> str:
    return _load_hard_constraints()


def _insert_qa_review(
    cur: Any,
    version_id: str,
    composite_score: float,
    passed: bool,
    pass_threshold: float,
    keyword_match: float,
    experience_match: float,
    seniority_match: float,
    structure_valid: bool,
    gaps: list,
    raw_feedback: str,
) -> str:
    cur.execute(
        """
        INSERT INTO qa_reviews (
            version_id, score, passed, score_threshold,
            keyword_match, experience_match, seniority_match,
            structure_valid, gaps, raw_feedback
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        RETURNING review_id
        """,
        (
            version_id,
            composite_score,
            passed,
            pass_threshold,
            keyword_match,
            experience_match,
            seniority_match,
            structure_valid,
            json.dumps(gaps),
            raw_feedback,
        ),
    )
    return str(cur.fetchone()[0])


EVALUATION_PROMPT = """\
You are a **resume quality assurance and ATS audit system**.

Your task is to **analyze a generated resume against a job description and identify gaps, weaknesses, and improvement opportunities**.

You are NOT generating a resume.
You are performing a **diagnostic smoke test**.

Your goal is to produce feedback that another LLM can use to **improve the resume while remaining truthful and grounded**.

{hard_constraints_section}

CONSTRAINT VIOLATION CHECK (run before scoring):
{constraint_violations_check}

------------------------------------------------
INPUTS
------------------------------------------------

JOB DESCRIPTION
<JOB_DESCRIPTION>
Company: {company_name}
Role: {role_title}
Seniority Level: {seniority_level}

{jd_text}

Required Skills:
{required_skills}

Nice-to-Have Skills:
{nice_to_haves}
</JOB_DESCRIPTION>

GENERATED RESUME
<GENERATED_RESUME>
{resume_content}
</GENERATED_RESUME>

------------------------------------------------
ANALYSIS FRAMEWORK
------------------------------------------------

Work through the following steps internally before producing your final JSON output.

STEP 1 — JOB REQUIREMENT EXTRACTION
Extract from the job description:
- primary_role
- required_skills
- preferred_skills
- responsibilities
- domain_keywords
- seniority_level

STEP 2 — RESUME SIGNAL EXTRACTION
Extract from the resume:
- role_identity
- primary_technologies
- secondary_technologies
- infrastructure_tools
- domains
- quantified_achievements

STEP 3 — ALIGNMENT ANALYSIS
Compare JOB_REQUIREMENTS vs RESUME_SIGNALS:
- strong_matches: skills or experiences that clearly match the job
- partial_matches: areas where the resume hints at capability but could be clearer
- missing_keywords: important keywords from the JD not present in the resume
- weak_signals: areas where the resume undersells relevant experience

STEP 4 — ATS OPTIMIZATION CHECK
Evaluate ATS readiness:
- keyword_coverage_score (0–100 estimate)
- missing_ats_keywords: keywords from the JD that should appear somewhere
- keyword_placement_issues: keywords that exist but are buried or poorly placed
- keyword_stuffing_risk: unnatural repetition of keywords

STEP 5 — RECRUITER SCANNABILITY TEST
Simulate a recruiter scanning in 3–5 seconds:
- 3_second_impression: what a recruiter would immediately infer
- clarity_of_role_identity: is the candidate's role obvious?
- tech_stack_visibility: are key technologies immediately visible?
- bullet_quality_issues: too long / vague / missing technologies / missing impact

STEP 6 — BULLET QUALITY ANALYSIS
For each problematic bullet identify:
- bullet_issue_type: vague | lacks technology | lacks measurable impact | too long | too generic
- suggested_improvement_pattern using structure: ACTION + TECHNOLOGY + IMPACT
Do NOT fabricate metrics or technologies.

STEP 7 — SKILL SECTION ANALYSIS
- missing_skill_categories: important categories missing from skills section
- skills_not_prioritized: relevant skills that should appear earlier
- keyword_bridging_opportunities: technologies that could safely appear under "Familiar With" or "Exposure To"

STEP 8 — SCORING
Based on the full analysis above, score across EXACTLY 6 dimensions:

keyword_match (float 0.0–1.0, weight 0.35):
- Extract all technical keywords, tools, frameworks, certifications from required_skills and jd_text.
- Extract nice-to-have keywords separately.
- Search resume body (experience bullets, skills, summary) for each. Case-insensitive. Accept unambiguous synonyms only (k8s=Kubernetes, JS=JavaScript). Do NOT accept vague partial matches.
- Score = (required_hits * 2 + nice_to_have_hits) / (required_total * 2 + nice_to_have_total). Clamp to [0.0, 1.0].
- Do NOT count a skill as a hit if it is marked [DO NOT CLAIM] in the hard constraints.

experience_match (float 0.0–1.0, weight 0.30):
- Extract core responsibilities from jd_text (ignore boilerplate, EEO, benefits).
- For each responsibility, find the best matching resume bullet:
  * 1.0 if bullet demonstrates the task with quantified impact
  * 0.7 if bullet describes the activity without measurable outcome
  * 0.3 if only tangentially related
  * 0.0 if no match
- Score = sum(match_scores) / count(responsibilities). Clamp to [0.0, 1.0].
- Skills list alone does NOT count as experience evidence.

seniority_match (float 0.0–1.0, weight 0.12):
- Expected signals by level:
  * junior/entry: learning orientation, contribution to team, foundational skills, mentorship received
  * mid: feature ownership, independent delivery, cross-functional collaboration
  * senior: system design, architectural decisions, mentoring others, business impact at scale
  * lead/staff/principal: strategic direction, org-wide influence, defining standards, leading teams
- Start at 1.0. Deduct 0.15 per under-levelled signal (max -0.45). Deduct 0.10 per over-levelled signal (max -0.30). Clamp to [0.0, 1.0].
- Do NOT penalise for having experience above target level unless framing actively misaligns.

structure_valid (boolean, gate + 0.08 bonus):
- TRUE only if ALL of the following are present and valid:
  * Contact information (name, email, at least one of: phone, location, website)
  * Professional summary or objective
  * Work experience (at least one entry with company, title/position, dates, and at least one bullet)
  * Skills section (at least one entry)
  * Education (at least one entry with institution and degree/credential)
- Set to FALSE if ANY of these fail:
  * Required section missing
  * Placeholder text in any value: TODO, FIXME, [INSERT, [YOUR, XXX, PLACEHOLDER, <REPLACE>, or pattern [.*?...]
  * Contact information (name, email) altered or removed from base
  * Document under 200 characters
  * Duplicate section headers
- If structure_valid is FALSE, composite_score = 0.000 (gate enforced server-side).

STEP 9 — ATS PARSEABILITY CHECK

ats_parseable (boolean, weight 0.08):
- TRUE if resume has NO tables, NO images, standard Markdown headers only (# ## ###), NO Unicode art separators (e.g., ━━━, ═══, ▸, ●), and no multi-column layouts.
- Default TRUE for well-formed single-column Markdown.
- Set FALSE if any of the above anti-patterns are detected — they break ATS parsers.
- This guards against Resume Tailor formatting errors that look fine visually but fail ATS ingestion.

STEP 10 — BULLET IMPACT SCORING

bullet_impact (float 0.0–1.0, weight 0.07):
- Average score across ALL work experience bullets in the resume.
- Score each bullet individually using this rubric:
  * 1.0: action verb + quantified metric (%, $, number of users, Xms latency, X× improvement)
  * 0.7: action verb + specific deliverable (concrete system/feature, no metric)
  * 0.4: passive voice or vague language ("responsible for", "helped with", "worked on", "assisted")
  * 0.0: placeholder text, pure technology list, or filler ("good communication skills")
- Do NOT fabricate metrics. Score what is actually written.
- bullet_impact = mean(individual_bullet_scores). Clamp to [0.0, 1.0].

STEP 11 — HOOK TEST (diagnostic only — does NOT affect composite score)

hook_score (float 0.0–1.0, 4 criteria each worth 0.25):
  1. Summary contains: role title + years of experience + at least one specific company/project name
  2. First job entry shows company name + role title immediately (not buried in bullet text)
  3. Summary opens with an action noun or title (NOT "I am" or "Motivated" or "Passionate")
  4. Top third of resume shows at least one quantified achievement
- hook_score = (criteria_met * 0.25). Clamp to [0.0, 1.0].
- NOTE: hook_score is a diagnostic metric only. It does NOT affect composite_score.
- If hook_score < 0.5: flag as HIGH severity gap in raw_feedback under "HOOK TEST FAILURE".

STEP 12 — RELEVANCE DENSITY (diagnostic only — does NOT affect composite score)

relevance_density (float 0.0–1.0):
- relevant_bullets / total_bullets across all work experience sections.
- A bullet is "relevant" if it directly addresses a required_skill or a JD responsibility.
- relevance_density = relevant_count / total_count. Clamp to [0.0, 1.0].
- NOTE: relevance_density is a diagnostic metric only. It does NOT affect composite_score.
- If relevance_density < 0.6: flag as MEDIUM severity gap in raw_feedback under "LOW RELEVANCE DENSITY".

COMPOSITE SCORE FORMULA (use exactly):
  if not structure_valid:
      composite_score = 0.000
  else:
      composite_score = round(
          (keyword_match * 0.35) + (experience_match * 0.30) + (seniority_match * 0.12)
          + (float(ats_parseable) * 0.08) + (bullet_impact * 0.07) + 0.08,
          3
      )
  Clamp final value to [0.000, 1.000].

------------------------------------------------
GAP RULES
------------------------------------------------

- Every gap must be specific, actionable, and reference the JD or constraint directly.
- "Needs improvement" is NOT valid. "Required keyword 'Terraform' appears 3 times in JD but absent from resume" IS valid.
- Sort: severity descending (high→medium→low), then category alphabetically within same severity.
- Max 15 gaps. If more exist, keep the 15 highest severity.
- On PASS: gaps array may be empty or contain only 'low' severity items. NEVER include 'high' severity on a pass.
- On FAIL/LOW_MATCH: must include at least one 'high' severity gap.

SUGGESTION QUALITY RULES:
- Every gap MUST include a suggestion field specific enough for another LLM to implement directly.
- Bad suggestion: "Improve this bullet" — Good suggestion: "Rewrite bullet 2 under Company X to lead with 'Reduced' and include the 40% latency metric from your JD analysis"
- For hook gaps: reference the specific summary line or first-job element that needs changing
- For relevance gaps: identify which specific bullets are irrelevant and suggest what to replace them with
- For keyword gaps: name the exact keyword and the specific bullet or skills section where it should appear
- For experience gaps: identify the specific JD responsibility not demonstrated and suggest which existing bullet to expand

THRESHOLD-TRIGGERED GAP RULES:
- ats_parseable = FALSE → HIGH severity, category: structure, dimension: ats_parseable — suggest specific formatting fix
- bullet_impact < 0.6 → MEDIUM severity, category: impact, dimension: bullet_impact — identify 2–3 weakest bullets by company/position
- hook_score < 0.5 → HIGH severity, category: hook, dimension: hook_score — suggest specific changes to summary and first job entry
- relevance_density < 0.6 → MEDIUM severity, category: relevance, dimension: relevance_density — identify which bullets are irrelevant

------------------------------------------------
IMPORTANT RULES
------------------------------------------------

1. Do NOT fabricate information.
2. Do NOT rewrite the entire resume.
3. Provide diagnostic feedback only.
4. Feedback must be actionable for another LLM to implement.

------------------------------------------------
OUTPUT
------------------------------------------------

Return your response in TWO parts separated by the exact delimiter ===GAPS===.

PART 1 — JSON object (no markdown fences, no explanation):
The raw_feedback field must contain your full structured analysis from Steps 1–12 above,
including RESUME_IMPROVEMENT_INSTRUCTIONS with high/medium/low priority changes,
keyword insertion opportunities, bullet rewrite targets, summary improvement advice,
skills section improvements, hook test results, and relevance density findings.

{{
  "keyword_match": <float 3 decimal places>,
  "experience_match": <float 3 decimal places>,
  "seniority_match": <float 3 decimal places>,
  "structure_valid": <true|false>,
  "ats_parseable": <true|false>,
  "bullet_impact": <float 3 decimal places>,
  "hook_score": <float 3 decimal places>,
  "relevance_density": <float 3 decimal places>,
  "composite_score": <float 3 decimal places>,
  "raw_feedback": "<full structured analysis from Steps 1–12 and improvement instructions>"
}}

===GAPS===

PART 2 — Gaps in TOON format (max 15, sorted: severity desc then category asc within same severity):
gaps[N]{{category,severity,dimension,detail,suggestion}}:
  <category>,<severity>,<dimension>,"<specific actionable detail referencing JD>","<concrete rewrite instruction specific enough for another LLM to implement>"

Category values: skills | experience | seniority | structure | constraint_violation | impact | hook | relevance
Severity values: high | medium | low
Dimension values: keyword_match | experience_match | seniority_match | ats_parseable | bullet_impact | hook_score | relevance_density | structure
If there are no gaps to report, write: gaps[0]{{category,severity,dimension,detail,suggestion}}:
"""


CONSTRAINT_VIOLATIONS_CHECK = """\
Cross-reference the resume against the CANDIDATE HARD CONSTRAINTS above.
Flag as HIGH severity gap (category: "constraint_violation") any claim in the resume that:
  * Claims a skill explicitly listed as [DO NOT CLAIM] in the hard constraints
  * Inflates total years of experience beyond what is stated in the constraints
  * Uses a job title (Lead, Senior, Manager, Principal) not matching the verified title
  * Attributes a metric to the wrong employer (e.g., PPLWork metric used in an Openspace bullet)
  * Describes an academic/personal project as "production deployed" when constraints say otherwise
  * Alters contact information (name, email, phone, LinkedIn) from the verified values
  * Lists a certification as completed when the constraints mark it as ongoing
If the hard constraints section is empty, skip this check entirely.\
"""


class AgentError(RuntimeError):
    pass


def _get_conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])



def _compute_composite(
    keyword_match: float,
    experience_match: float,
    seniority_match: float,
    structure_valid: bool,
    ats_parseable: bool,
    bullet_impact: float,
) -> float:
    """Compute 6-dimension composite score.

    Formula (weights sum to 1.00):
      keyword_match    * 0.35
      experience_match * 0.30
      seniority_match  * 0.12
      ats_parseable    * 0.08   (boolean cast to float)
      bullet_impact    * 0.07
      structure bonus    0.08   (only applied when structure_valid is TRUE)

    structure_valid gate: if FALSE, composite = 0.000 immediately.
    """
    if not structure_valid:
        return 0.000
    score = round(
        (keyword_match * 0.35)
        + (experience_match * 0.30)
        + (seniority_match * 0.12)
        + (float(ats_parseable) * 0.08)
        + (bullet_impact * 0.07)
        + 0.08,
        3,
    )
    return max(0.000, min(1.000, score))


def _write_error_event(conn: Any, job_id: str, event_type: str, error_msg: str, model: str) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET status = 'error', updated_at = NOW() WHERE job_id = %s",
                (job_id,),
            )
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, model_used, detail, payload)
                VALUES (%s, %s, 'quality_analyst', %s, %s, %s::jsonb)
                """,
                (job_id, event_type, model, error_msg, json.dumps({"error": error_msg})),
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
    version_id: str,
    iteration_number: int,
    model: str = MODEL,
    event_callback: EventCallback = None,
) -> dict:
    """
    Evaluate the tailored resume for this version_id.
    Returns a signal dict with outcome, score, and gaps.
    Raises AgentError on failure.
    """
    pass_threshold = float(os.getenv("QA_PASS_THRESHOLD", "0.92"))
    max_iterations = int(os.getenv("MAX_TAILORING_ITERATIONS", "4"))

    conn = _get_conn()
    try:
        # ── Step 1: Read inputs ───────────────────────────────────────────────
        _notify(event_callback, "    Reading job description and resume from DB...", {
            "event_type": "agent_progress", "agent_name": "quality_analyst",
            "detail": "Reading job description and resume...",
        })
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT jd_text, required_skills, nice_to_haves,
                       seniority_level, company_name, role_title, iteration_count
                FROM jobs WHERE job_id = %s
                """,
                (job_id,),
            )
            job = cur.fetchone()

        if not job:
            _write_error_event(conn, job_id, "qa_input_validation_failed", f"Job not found: {job_id}", model)
            raise AgentError(f"Job not found: {job_id}")

        # Validate inputs
        validation_errors = []
        if not job["jd_text"] or len(job["jd_text"]) < 50:
            validation_errors.append("jd_text is NULL, empty, or < 50 chars")
        if job["required_skills"] is None:
            validation_errors.append("required_skills is NULL")

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT latex_source, version_number, tailoring_notes, job_id FROM resume_versions WHERE version_id = %s",
                (version_id,),
            )
            rv = cur.fetchone()

        if not rv:
            validation_errors.append(f"version_id not found: {version_id}")
        elif str(rv["job_id"]) != str(job_id):
            validation_errors.append(f"version_id {version_id} does not belong to job_id {job_id}")
        elif not rv["latex_source"]:
            validation_errors.append("latex_source (resume content) is NULL or empty")

        if validation_errors:
            msg = "; ".join(validation_errors)
            _write_error_event(conn, job_id, "qa_input_validation_failed", msg, model)
            raise AgentError(f"QA input validation failed: {msg}")

        resume_content = rv["latex_source"]
        iteration_count = job["iteration_count"] or 0

        # ── Step 2: Evaluate via LLM ──────────────────────────────────────────
        _notify(event_callback, "    Loading hard constraints...", None)
        hard_constraints = _get_hard_constraints(conn)
        hard_constraints_section = (
            f"=== CANDIDATE HARD CONSTRAINTS ===\n{hard_constraints}"
            if hard_constraints else ""
        )

        _notify(event_callback, "    Evaluating resume against job description via LLM...", {
            "event_type": "agent_progress", "agent_name": "quality_analyst",
            "detail": "Running QA evaluation...",
        })
        # QA must return structured JSON reliably; give it a large output budget
        # but keep internal reasoning bounded so the response does not end before
        # the JSON payload is emitted.
        llm = load_llm(
            model_name=model,
            temperature=0.1,
            max_tokens=100000,
            reasoning_budget_tokens=50000,
        )
        prompt = EVALUATION_PROMPT.format(
            hard_constraints_section="",
            constraint_violations_check="(Hard constraint checking is currently disabled — skip this check.)",
            company_name=job["company_name"] or "",
            role_title=job["role_title"] or "",
            seniority_level=job["seniority_level"] or "mid",
            jd_text=(job["jd_text"] or "")[:8000],
            required_skills=toon_list("required_skills", job["required_skills"] or []),
            nice_to_haves=toon_list("nice_to_haves", job["nice_to_haves"] or []) if job["nice_to_haves"] else "(none)",
            resume_content=resume_content[:8000],
        )

        # ── Prompt trace ──────────────────────────────────────────────────────
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, model_used, detail, payload)
                VALUES (%s, 'llm_prompt_trace', 'quality_analyst', %s, %s, %s::jsonb)
                """,
                (
                    job_id,
                    model,
                    f"QA evaluation prompt sent to LLM (iteration {iteration_number})",
                    json.dumps({
                        "direction": "quality_analyst→llm",
                        "iteration": iteration_number,
                        "version_id": version_id,
                        "prompt_length": len(prompt),
                        "prompt": prompt,
                    }),
                ),
            )
        conn.commit()

        raw_response = llm.invoke(prompt)

        # ── Parse split response: JSON scalars + TOON gaps ────────────────────
        _GAPS_DELIMITER = "===GAPS==="
        if _GAPS_DELIMITER in raw_response:
            json_part, toon_part = raw_response.split(_GAPS_DELIMITER, 1)
            evaluation = extract_json(json_part)
            gaps: list = parse_toon_table(toon_part, ["category", "severity", "dimension", "detail", "suggestion"])
        else:
            # Fallback: LLM returned plain JSON (old format or non-compliant response)
            evaluation = extract_json(raw_response)
            raw_gaps = evaluation.get("gaps", [])
            gaps = raw_gaps if isinstance(raw_gaps, list) else []

        # Backward-compat: ensure every gap dict has suggestion and dimension fields
        for gap in gaps:
            if isinstance(gap, dict):
                gap.setdefault("suggestion", "")
                gap.setdefault("dimension", gap.get("category", ""))

        # ── Step 3: Extract and validate scores ───────────────────────────────
        keyword_match = round(max(0.0, min(1.0, float(evaluation.get("keyword_match", 0)))), 3)
        experience_match = round(max(0.0, min(1.0, float(evaluation.get("experience_match", 0)))), 3)
        seniority_match = round(max(0.0, min(1.0, float(evaluation.get("seniority_match", 0)))), 3)
        structure_valid: bool = bool(evaluation.get("structure_valid", False))
        raw_feedback: str = evaluation.get("raw_feedback", "")

        # New 6-dimension fields — safe defaults preserve old behaviour on partial responses
        ats_parseable: bool = bool(evaluation.get("ats_parseable", True))
        bullet_impact: float = round(max(0.0, min(1.0, float(evaluation.get("bullet_impact", 0.5)))), 3)
        hook_score_val: float = round(max(0.0, min(1.0, float(evaluation.get("hook_score", 0.5)))), 3)
        relevance_density_val: float = round(max(0.0, min(1.0, float(evaluation.get("relevance_density", 0.5)))), 3)

        if not raw_feedback:
            raw_feedback = "Automated QA evaluation completed."

        # ── Step 4: Compute composite score (always use our formula, not LLM's) ──
        composite_score = _compute_composite(
            keyword_match, experience_match, seniority_match,
            structure_valid, ats_parseable, bullet_impact,
        )
        _notify(event_callback, (
            f"    Scores — keyword: {keyword_match:.3f}, experience: {experience_match:.3f}, "
            f"seniority: {seniority_match:.3f}, structure: {'pass' if structure_valid else 'fail'}, "
            f"ats: {'pass' if ats_parseable else 'fail'}, bullet_impact: {bullet_impact:.3f}"
        ), {
            "event_type": "qa_scores", "agent_name": "quality_analyst",
            "detail": f"QA Score: {composite_score:.3f}",
            "metadata": {
                "keyword_match": keyword_match,
                "experience_match": experience_match,
                "seniority_match": seniority_match,
                "structure_valid": structure_valid,
                "ats_parseable": ats_parseable,
                "bullet_impact": bullet_impact,
                "hook_score": hook_score_val,
                "relevance_density": relevance_density_val,
                "composite_score": composite_score,
                "threshold": pass_threshold,
            },
        })
        _notify(event_callback, f"    Composite score: {composite_score:.3f} (threshold: {pass_threshold})", None)

        # Validate score range
        if not (0.000 <= composite_score <= 1.000):
            _write_error_event(conn, job_id, "qa_internal_error", f"Composite score out of range: {composite_score}", model)
            raise AgentError(f"Composite score out of range: {composite_score}")

        # Determine pass/fail — requires both score threshold AND structure_valid
        passed = composite_score >= pass_threshold and structure_valid

        # ── Step 5: Write qa_reviews (INSERT only) ────────────────────────────
        review_id: str
        with conn.cursor() as cur:
            review_id = _insert_qa_review(
                cur,
                version_id=version_id,
                composite_score=composite_score,
                passed=passed,
                pass_threshold=pass_threshold,
                keyword_match=keyword_match,
                experience_match=experience_match,
                seniority_match=seniority_match,
                structure_valid=structure_valid,
                gaps=gaps,
                raw_feedback=raw_feedback,
            )

        # ── Step 6: Determine outcome and update jobs.status ──────────────────
        if passed:
            outcome = "pass"
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE jobs SET status = 'approved', active_resume_id = %s, updated_at = NOW() WHERE job_id = %s",
                    (version_id, job_id),
                )
            event_type = "qa_passed"
        elif iteration_count < max_iterations:
            outcome = "fail"
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE jobs SET status = 'qa_failed', updated_at = NOW() WHERE job_id = %s",
                    (job_id,),
                )
            event_type = "qa_failed"
        else:
            outcome = "low_match"
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE jobs SET status = 'low_match', updated_at = NOW() WHERE job_id = %s",
                    (job_id,),
                )
            event_type = "qa_low_match"

        # ── Step 7: Write pipeline_events (last DB operation) ─────────────────
        gaps_count = len(gaps)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_events
                    (job_id, event_type, agent_name, model_used, payload)
                VALUES (%s, %s, 'quality_analyst', %s, %s::jsonb)
                """,
                (
                    job_id,
                    event_type,
                    model,
                    json.dumps({
                        "score": composite_score,
                        "passed": passed,
                        "gaps_count": gaps_count,
                        "iteration": iteration_number,
                        "version_id": version_id,
                        "threshold": pass_threshold,
                        "keyword_match": keyword_match,
                        "experience_match": experience_match,
                        "seniority_match": seniority_match,
                        "structure_valid": structure_valid,
                        "ats_parseable": ats_parseable,
                        "bullet_impact": bullet_impact,
                        "hook_score": hook_score_val,
                        "relevance_density": relevance_density_val,
                    }),
                ),
            )

        conn.commit()

        signal = {
            "outcome": outcome,
            "job_id": job_id,
            "version_id": version_id,
            "review_id": review_id,
            "score": composite_score,
            "passed": passed,
            "gaps": gaps,
            "iteration": iteration_number,
        }
        if outcome in ("fail", "low_match"):
            signal["iterations_exhausted"] = iteration_count
        return signal

    except AgentError:
        raise
    except Exception as e:
        _write_error_event(conn, job_id, "qa_internal_error", str(e), model)
        raise AgentError(f"quality_analyst failed: {e}") from e
    finally:
        conn.close()
