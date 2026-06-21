"""Morning job review CLI.

Shows pending discovered jobs and lets the user approve or reject each one.
Approved jobs are inserted into the main pipeline (jobs table, status='new').

Usage:
    uv run python review_jobs.py           # review all pending
    uv run python review_jobs.py --all     # include previously rejected jobs too
    uv run python review_jobs.py --limit 20
"""

import argparse
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_GREEN = "\033[32m"
_RED = "\033[31m"
_YELLOW = "\033[33m"
_CYAN = "\033[36m"


def _conn() -> Any:
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _fetch_pending(conn: Any, include_rejected: bool, limit: int) -> list[dict]:
    statuses = ("pending_review", "rejected") if include_rejected else ("pending_review",)
    placeholders = ",".join(["%s"] * len(statuses))
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            f"""
            SELECT id, job_url, title, company, location, platform,
                   raw_snippet, relevance_score, discovered_at
            FROM discovered_jobs
            WHERE status IN ({placeholders})
            ORDER BY relevance_score DESC NULLS LAST, discovered_at DESC
            LIMIT %s
            """,
            (*statuses, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def _approve(conn: Any, discovered_id: str, job_url: str) -> str:
    """Insert into jobs table and link back to discovered_jobs. Returns new job_id."""
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs (job_id, job_url, status, created_at, updated_at)
            VALUES (%s, %s, 'new', %s, %s)
            ON CONFLICT (job_url) WHERE job_url IS NOT NULL AND job_url != ''
            DO UPDATE SET updated_at = %s
            RETURNING job_id
            """,
            (job_id, job_url, now, now, now),
        )
        returned = cur.fetchone()
        actual_job_id = returned[0] if returned else job_id

        cur.execute(
            """
            UPDATE discovered_jobs
            SET status = 'queued', job_id = %s, reviewed_at = %s
            WHERE id = %s
            """,
            (actual_job_id, now, discovered_id),
        )
    conn.commit()
    return str(actual_job_id)


def _reject(conn: Any, discovered_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE discovered_jobs SET status = 'rejected', reviewed_at = NOW() WHERE id = %s",
            (discovered_id,),
        )
    conn.commit()


def _format_score(score: float | None) -> str:
    if score is None:
        return f"{_DIM}n/a{_RESET}"
    if score >= 0.7:
        return f"{_GREEN}{score:.3f}{_RESET}"
    if score >= 0.4:
        return f"{_YELLOW}{score:.3f}{_RESET}"
    return f"{_RED}{score:.3f}{_RESET}"


def _print_job(i: int, total: int, job: dict) -> None:
    print(f"\n{_BOLD}─── Job {i}/{total} ───{_RESET}")
    print(f"  {_BOLD}{job['title']}{_RESET}  @  {_CYAN}{job['company']}{_RESET}")
    print(f"  Platform:  {job['platform']}   Relevance: {_format_score(job.get('relevance_score'))}")
    if job.get("location"):
        print(f"  Location:  {job['location']}")
    print(f"  URL:       {_DIM}{job['job_url']}{_RESET}")
    if job.get("raw_snippet"):
        snippet = job["raw_snippet"][:200].replace("\n", " ")
        print(f"  Snippet:   {_DIM}{snippet}…{_RESET}")


def _prompt_user() -> str:
    while True:
        choice = input(f"\n  {_BOLD}[a]{_RESET}pprove  {_BOLD}[r]{_RESET}eject  {_BOLD}[s]{_RESET}kip  {_BOLD}[q]{_RESET}uit  > ").strip().lower()
        if choice in ("a", "r", "s", "q"):
            return choice
        print("  Please enter a, r, s, or q.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Review discovered jobs")
    parser.add_argument("--all", dest="include_rejected", action="store_true",
                        help="Include previously rejected jobs")
    parser.add_argument("--limit", type=int, default=50, help="Max jobs to review (default 50)")
    args = parser.parse_args()

    conn = _conn()
    jobs = _fetch_pending(conn, args.include_rejected, args.limit)

    if not jobs:
        print("No pending jobs to review. Run the scheduler or check your search_preferences.")
        conn.close()
        return

    approved, rejected, skipped = 0, 0, 0
    total = len(jobs)

    print(f"\n{_BOLD}Rendure — Job Review{_RESET}  ({total} pending)")
    print("─" * 50)

    for i, job in enumerate(jobs, start=1):
        _print_job(i, total, job)
        choice = _prompt_user()

        if choice == "q":
            print("\nReview paused. Remaining jobs stay pending.")
            break
        elif choice == "a":
            job_id = _approve(conn, str(job["id"]), job["job_url"])
            print(f"  {_GREEN}✓ Queued{_RESET} — pipeline job_id: {job_id}")
            approved += 1
        elif choice == "r":
            _reject(conn, str(job["id"]))
            print(f"  {_RED}✗ Rejected{_RESET}")
            rejected += 1
        else:
            print(f"  {_DIM}Skipped{_RESET}")
            skipped += 1

    print(f"\n{_BOLD}Review complete:{_RESET}  {_GREEN}{approved} approved{_RESET}  "
          f"{_RED}{rejected} rejected{_RESET}  {_DIM}{skipped} skipped{_RESET}")
    print(f"Approved jobs are in the pipeline. Run: {_CYAN}uv run python run_agents.py <url>{_RESET} "
          f"or wait for the orchestrator to pick them up.\n")
    conn.close()


if __name__ == "__main__":
    main()
