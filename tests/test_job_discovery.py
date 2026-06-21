"""Tests for the Job Discovery agent."""

from unittest.mock import MagicMock, call, patch

import psycopg2
import pytest

from agents.discovery.types import DiscoveredJob
from agents.job_discovery import run, _write_discovered_jobs, _load_preferences


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_job(
    title="Software Engineer",
    company="Acme",
    url="https://example.com/job/1",
    platform="greenhouse",
) -> DiscoveredJob:
    return DiscoveredJob(
        url=url,
        title=title,
        company=company,
        location="Remote",
        platform=platform,
        raw_snippet="Python PostgreSQL distributed systems",
    )


def _make_conn(existing_urls: set[str] | None = None):
    """Mock psycopg2 connection with a cursor that returns no existing URLs."""
    conn = MagicMock()
    cur = MagicMock()
    cur.rowcount = 1  # simulate successful INSERT
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cur.fetchall.return_value = [(u,) for u in (existing_urls or [])]
    return conn, cur


PREFS_ROW = {
    "target_roles": ["Software Engineer"],
    "keywords": ["Python"],
    "locations": ["Remote"],
    "excluded_companies": [],
    "min_seniority": None,
    "greenhouse_companies": ["stripe", "shopify"],
    "lever_companies": ["vercel"],
    "ashby_companies": ["linear"],
    "indeed_queries": [{"q": "software engineer", "l": "remote"}],
    "workday_urls": [],
    "career_page_urls": [],
}


# ---------------------------------------------------------------------------
# _load_preferences
# ---------------------------------------------------------------------------

def test_load_preferences_reads_from_db():
    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cur.fetchone.return_value = PREFS_ROW

    prefs = _load_preferences(conn)
    assert prefs["greenhouse_companies"] == ["stripe", "shopify"]


def test_load_preferences_returns_empty_defaults_when_no_row():
    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    cur.fetchone.return_value = None

    prefs = _load_preferences(conn)
    assert prefs["greenhouse_companies"] == []


# ---------------------------------------------------------------------------
# _write_discovered_jobs
# ---------------------------------------------------------------------------

def test_write_discovered_jobs_inserts_each_job():
    conn, cur = _make_conn()
    jobs = [_make_job(), _make_job(title="Staff Engineer", url="https://example.com/job/2")]

    _write_discovered_jobs(conn, jobs, scores={j["url"]: 0.8 for j in jobs})

    assert cur.execute.call_count >= 2


def test_write_discovered_jobs_skips_empty_url():
    conn, cur = _make_conn()
    bad_job = DiscoveredJob(url="", title="Engineer", company="X", location=None, platform="greenhouse", raw_snippet=None)
    _write_discovered_jobs(conn, [bad_job], scores={})
    # Should execute at most 1 call (the existing-urls check), not an INSERT
    insert_calls = [c for c in cur.execute.call_args_list if "INSERT" in str(c)]
    assert len(insert_calls) == 0


def test_write_discovered_jobs_uses_on_conflict_do_nothing():
    conn, cur = _make_conn()
    job = _make_job()
    _write_discovered_jobs(conn, [job], scores={job["url"]: 0.7})

    all_sql = " ".join(str(c) for c in cur.execute.call_args_list)
    assert "ON CONFLICT" in all_sql


# ---------------------------------------------------------------------------
# run()
# ---------------------------------------------------------------------------

def test_run_calls_greenhouse_for_each_company():
    with patch("agents.job_discovery._get_conn") as mock_conn_fn, \
         patch("agents.job_discovery._load_preferences") as mock_prefs, \
         patch("agents.job_discovery.greenhouse.fetch_jobs") as mock_gh, \
         patch("agents.job_discovery.lever.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.ashby.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.indeed_rss.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery._write_discovered_jobs"):

        mock_conn_fn.return_value = MagicMock()
        mock_prefs.return_value = {**PREFS_ROW}
        mock_gh.return_value = []

        run()

    assert mock_gh.call_count == 2  # stripe + shopify


def test_run_calls_lever_for_each_company():
    with patch("agents.job_discovery._get_conn") as mock_conn_fn, \
         patch("agents.job_discovery._load_preferences") as mock_prefs, \
         patch("agents.job_discovery.greenhouse.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.lever.fetch_jobs") as mock_lever, \
         patch("agents.job_discovery.ashby.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.indeed_rss.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery._write_discovered_jobs"):

        mock_conn_fn.return_value = MagicMock()
        mock_prefs.return_value = {**PREFS_ROW}
        mock_lever.return_value = []

        run()

    assert mock_lever.call_count == 1  # vercel


def test_run_calls_indeed_for_each_query():
    with patch("agents.job_discovery._get_conn") as mock_conn_fn, \
         patch("agents.job_discovery._load_preferences") as mock_prefs, \
         patch("agents.job_discovery.greenhouse.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.lever.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.ashby.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.indeed_rss.fetch_jobs") as mock_indeed, \
         patch("agents.job_discovery._write_discovered_jobs"):

        mock_conn_fn.return_value = MagicMock()
        mock_prefs.return_value = {**PREFS_ROW}
        mock_indeed.return_value = []

        run()

    assert mock_indeed.call_count == 1


def test_run_filters_irrelevant_jobs_before_writing():
    irrelevant = _make_job(title="Marketing Director - Brand", url="https://x.com/mkt")

    with patch("agents.job_discovery._get_conn") as mock_conn_fn, \
         patch("agents.job_discovery._load_preferences") as mock_prefs, \
         patch("agents.job_discovery.greenhouse.fetch_jobs", return_value=[irrelevant]), \
         patch("agents.job_discovery.lever.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.ashby.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.indeed_rss.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery._write_discovered_jobs") as mock_write:

        mock_conn_fn.return_value = MagicMock()
        mock_prefs.return_value = {**PREFS_ROW, "keywords": ["Python"]}

        run(relevance_threshold=0.9)  # very high threshold — marketing job should not pass

    written_jobs = mock_write.call_args[0][1] if mock_write.called else []
    assert all(j["url"] != irrelevant["url"] for j in written_jobs)


def test_run_deduplicates_same_url_across_platforms():
    job_a = _make_job(url="https://dupe.com/job/1", platform="greenhouse")
    job_b = _make_job(url="https://dupe.com/job/1", platform="lever")

    with patch("agents.job_discovery._get_conn") as mock_conn_fn, \
         patch("agents.job_discovery._load_preferences") as mock_prefs, \
         patch("agents.job_discovery.greenhouse.fetch_jobs", return_value=[job_a]), \
         patch("agents.job_discovery.lever.fetch_jobs", return_value=[job_b]), \
         patch("agents.job_discovery.ashby.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery.indeed_rss.fetch_jobs", return_value=[]), \
         patch("agents.job_discovery._write_discovered_jobs") as mock_write:

        mock_conn_fn.return_value = MagicMock()
        mock_prefs.return_value = {**PREFS_ROW}

        run()

    written_jobs = mock_write.call_args[0][1] if mock_write.called else []
    urls = [j["url"] for j in written_jobs]
    assert len(urls) == len(set(urls))
