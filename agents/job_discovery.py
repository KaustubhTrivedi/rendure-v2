"""Job Discovery Agent.

Ephemeral agent: runs on a schedule, discovers new job postings across all
configured platforms, scores them for relevance, deduplicates, and writes
qualifying jobs to the discovered_jobs staging table.

Jobs written here stay in status='pending_review' until the user reviews them
via the review CLI. Approved jobs are then inserted into the main jobs pipeline.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from agents.discovery import DiscoveredJob
from agents.discovery import platforms
from agents.discovery.platforms import greenhouse, lever, ashby, indeed_rss, workday, career_page
from agents.discovery.relevance import is_relevant, score_job

load_dotenv()

logger = logging.getLogger(__name__)

_DEFAULT_RELEVANCE_THRESHOLD = 0.40


def _get_conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _load_preferences(conn: Any) -> dict:
    """Read search_preferences row from DB. Returns empty defaults if no row."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM search_preferences WHERE id = 1")
        row = cur.fetchone()

    if row is None:
        return {
            "target_roles": [],
            "keywords": [],
            "locations": [],
            "excluded_companies": [],
            "min_seniority": None,
            "greenhouse_companies": [],
            "lever_companies": [],
            "ashby_companies": [],
            "indeed_queries": [],
            "workday_urls": [],
            "career_page_urls": [],
        }
    return dict(row)


def _write_discovered_jobs(
    conn: Any,
    jobs: list[DiscoveredJob],
    scores: dict[str, float],
) -> int:
    """Insert new discovered jobs into the staging table.

    Uses ON CONFLICT DO NOTHING so re-running the agent never duplicates rows.
    Returns the count of rows actually inserted.
    """
    inserted = 0
    with conn.cursor() as cur:
        for job in jobs:
            if not job["url"]:
                continue
            cur.execute(
                """
                INSERT INTO discovered_jobs
                    (job_url, title, company, location, platform, raw_snippet, relevance_score)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (job_url) DO NOTHING
                """,
                (
                    job["url"],
                    job["title"],
                    job["company"],
                    job.get("location"),
                    job["platform"],
                    job.get("raw_snippet"),
                    scores.get(job["url"]),
                ),
            )
            if cur.rowcount > 0:
                inserted += 1
    conn.commit()
    return inserted


def _deduplicate(jobs: list[DiscoveredJob]) -> list[DiscoveredJob]:
    """Remove duplicate URLs within a single discovery run."""
    seen: set[str] = set()
    unique: list[DiscoveredJob] = []
    for job in jobs:
        if job["url"] and job["url"] not in seen:
            seen.add(job["url"])
            unique.append(job)
    return unique


def run(relevance_threshold: float = _DEFAULT_RELEVANCE_THRESHOLD) -> dict:
    """Run a full discovery cycle across all configured platforms.

    Returns a summary dict with counts per platform and total written.
    """
    conn = _get_conn()
    try:
        prefs = _load_preferences(conn)

        all_jobs: list[DiscoveredJob] = []
        summary: dict[str, int] = {}

        # ── Greenhouse ────────────────────────────────────────────────────────
        for slug in prefs.get("greenhouse_companies") or []:
            found = greenhouse.fetch_jobs(slug)
            all_jobs.extend(found)
            summary[f"greenhouse:{slug}"] = len(found)
            logger.info("Greenhouse %s: %d jobs", slug, len(found))

        # ── Lever ─────────────────────────────────────────────────────────────
        for slug in prefs.get("lever_companies") or []:
            found = lever.fetch_jobs(slug)
            all_jobs.extend(found)
            summary[f"lever:{slug}"] = len(found)
            logger.info("Lever %s: %d jobs", slug, len(found))

        # ── Ashby ─────────────────────────────────────────────────────────────
        for slug in prefs.get("ashby_companies") or []:
            found = ashby.fetch_jobs(slug)
            all_jobs.extend(found)
            summary[f"ashby:{slug}"] = len(found)
            logger.info("Ashby %s: %d jobs", slug, len(found))

        # ── Indeed RSS ────────────────────────────────────────────────────────
        for query in prefs.get("indeed_queries") or []:
            q = query.get("q", "")
            loc = query.get("l", "")
            found = indeed_rss.fetch_jobs(q=q, location=loc)
            all_jobs.extend(found)
            summary[f"indeed:{q}"] = len(found)
            logger.info("Indeed '%s' @ '%s': %d jobs", q, loc, len(found))

        # ── Workday ───────────────────────────────────────────────────────────
        for url in prefs.get("workday_urls") or []:
            found = workday.fetch_jobs(url)
            all_jobs.extend(found)
            summary[f"workday:{url}"] = len(found)
            logger.info("Workday %s: %d jobs", url, len(found))

        # ── Career pages ──────────────────────────────────────────────────────
        for entry in prefs.get("career_page_urls") or []:
            page_url = entry if isinstance(entry, str) else entry.get("url", "")
            company_name = entry.get("company", page_url) if isinstance(entry, dict) else page_url
            found = career_page.fetch_jobs(page_url, company=company_name)
            all_jobs.extend(found)
            summary[f"career_page:{page_url}"] = len(found)
            logger.info("Career page %s: %d jobs", page_url, len(found))

        # ── Dedup + relevance filter ──────────────────────────────────────────
        unique_jobs = _deduplicate(all_jobs)
        relevant_jobs = [j for j in unique_jobs if is_relevant(j, prefs, threshold=relevance_threshold)]
        scores = {j["url"]: score_job(j, prefs) for j in relevant_jobs}

        logger.info(
            "Discovery: %d total → %d unique → %d relevant (threshold=%.2f)",
            len(all_jobs),
            len(unique_jobs),
            len(relevant_jobs),
            relevance_threshold,
        )

        inserted = _write_discovered_jobs(conn, relevant_jobs, scores)
        logger.info("Wrote %d new jobs to discovered_jobs", inserted)

        return {
            "total_found": len(all_jobs),
            "unique": len(unique_jobs),
            "relevant": len(relevant_jobs),
            "inserted": inserted,
            "platform_counts": summary,
        }

    finally:
        conn.close()
