"""Tests for the Greenhouse job board API client."""

from unittest.mock import MagicMock, patch

import pytest

from agents.discovery.platforms.greenhouse import fetch_jobs


SAMPLE_RESPONSE = {
    "jobs": [
        {
            "id": 1001,
            "title": "Senior Backend Engineer",
            "absolute_url": "https://boards.greenhouse.io/stripe/jobs/1001",
            "location": {"name": "Remote"},
            "content": "<p>We are looking for a senior backend engineer...</p>",
        },
        {
            "id": 1002,
            "title": "Staff Engineer",
            "absolute_url": "https://boards.greenhouse.io/stripe/jobs/1002",
            "location": {"name": "San Francisco, CA"},
            "content": "<p>Join our platform team...</p>",
        },
    ]
}


def _mock_get(url, **kwargs):
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = SAMPLE_RESPONSE
    resp.raise_for_status.return_value = None
    return resp


def test_fetch_jobs_returns_discovered_jobs_for_each_listing():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert len(jobs) == 2


def test_fetch_jobs_maps_title():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert jobs[0]["title"] == "Senior Backend Engineer"
    assert jobs[1]["title"] == "Staff Engineer"


def test_fetch_jobs_maps_url():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert jobs[0]["url"] == "https://boards.greenhouse.io/stripe/jobs/1001"


def test_fetch_jobs_maps_company_from_slug():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert jobs[0]["company"] == "stripe"


def test_fetch_jobs_maps_location():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert jobs[0]["location"] == "Remote"
    assert jobs[1]["location"] == "San Francisco, CA"


def test_fetch_jobs_sets_platform_to_greenhouse():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert all(j["platform"] == "greenhouse" for j in jobs)


def test_fetch_jobs_strips_html_from_snippet():
    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("stripe")

    assert "<p>" not in (jobs[0]["raw_snippet"] or "")
    assert "senior backend engineer" in (jobs[0]["raw_snippet"] or "").lower()


def test_fetch_jobs_returns_empty_list_on_http_error():
    def fail(*args, **kwargs):
        raise Exception("timeout")

    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=fail):
        jobs = fetch_jobs("stripe")

    assert jobs == []


def test_fetch_jobs_returns_empty_list_when_jobs_key_missing():
    def _mock(url, **kwargs):
        resp = MagicMock()
        resp.json.return_value = {}
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_mock):
        jobs = fetch_jobs("stripe")

    assert jobs == []


def test_fetch_jobs_calls_correct_greenhouse_api_url():
    captured = {}

    def _capture(url, **kwargs):
        captured["url"] = url
        resp = MagicMock()
        resp.json.return_value = {"jobs": []}
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.greenhouse.requests.get", side_effect=_capture):
        fetch_jobs("notion")

    assert captured["url"] == "https://api.greenhouse.io/v1/boards/notion/jobs"
