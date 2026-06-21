"""Tests for the relevance scoring filter."""

import pytest

from agents.discovery.relevance import score_job, is_relevant
from agents.discovery.types import DiscoveredJob


def _job(title: str, snippet: str | None = None, location: str | None = None) -> DiscoveredJob:
    return DiscoveredJob(
        url="https://example.com/job/1",
        title=title,
        company="Acme",
        location=location,
        platform="greenhouse",
        raw_snippet=snippet,
    )


PREFS = {
    "target_roles": ["Software Engineer", "Backend Engineer"],
    "keywords": ["Python", "PostgreSQL", "distributed systems"],
    "locations": ["Remote", "San Francisco"],
    "excluded_companies": ["BadCorp"],
    "min_seniority": None,
}


def test_score_is_between_zero_and_one():
    job = _job("Software Engineer")
    score = score_job(job, PREFS)
    assert 0.0 <= score <= 1.0


def test_exact_role_title_match_gives_high_score():
    job = _job("Software Engineer")
    score = score_job(job, PREFS)
    assert score >= 0.5


def test_unrelated_role_gives_low_score():
    job = _job("Marketing Manager - Brand Strategy")
    score = score_job(job, PREFS)
    assert score < 0.3


def test_keyword_in_snippet_boosts_score():
    job_no_kw = _job("Backend Engineer", snippet="Build APIs and services.")
    job_with_kw = _job("Backend Engineer", snippet="Build Python APIs with PostgreSQL.")
    score_no_kw = score_job(job_no_kw, PREFS)
    score_with_kw = score_job(job_with_kw, PREFS)
    assert score_with_kw > score_no_kw


def test_location_match_boosts_score():
    job_matched = _job("Software Engineer", location="Remote")
    job_no_match = _job("Software Engineer", location="Tokyo, Japan")
    s_matched = score_job(job_matched, PREFS)
    s_no_match = score_job(job_no_match, PREFS)
    assert s_matched >= s_no_match


def test_is_relevant_returns_true_above_threshold():
    job = _job("Software Engineer", snippet="Python PostgreSQL distributed systems")
    assert is_relevant(job, PREFS, threshold=0.3) is True


def test_is_relevant_returns_false_below_threshold():
    job = _job("Marketing Manager - Brand Strategy")
    assert is_relevant(job, PREFS, threshold=0.5) is False


def test_excluded_company_makes_job_not_relevant():
    job = DiscoveredJob(
        url="https://badcorp.com/jobs/1",
        title="Software Engineer",
        company="BadCorp",
        location="Remote",
        platform="greenhouse",
        raw_snippet="Python PostgreSQL",
    )
    assert is_relevant(job, PREFS, threshold=0.1) is False


def test_empty_preferences_still_returns_a_score():
    job = _job("Software Engineer")
    score = score_job(job, {
        "target_roles": [],
        "keywords": [],
        "locations": [],
        "excluded_companies": [],
        "min_seniority": None,
    })
    assert 0.0 <= score <= 1.0


def test_partial_title_word_match_scores_higher_than_zero():
    job = _job("Senior Software Engineer, Payments")
    score = score_job(job, PREFS)
    assert score > 0.0
