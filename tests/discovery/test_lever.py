"""Tests for the Lever job postings API client."""

from unittest.mock import MagicMock, patch

from agents.discovery.platforms.lever import fetch_jobs


SAMPLE_RESPONSE = [
    {
        "id": "abc-123",
        "text": "Senior Frontend Engineer",
        "hostedUrl": "https://jobs.lever.co/vercel/abc-123",
        "categories": {"location": "Remote"},
        "descriptionPlain": "We are looking for a frontend engineer to join our team...",
    },
    {
        "id": "def-456",
        "text": "Infrastructure Engineer",
        "hostedUrl": "https://jobs.lever.co/vercel/def-456",
        "categories": {"location": "San Francisco"},
        "descriptionPlain": "Join the infrastructure team...",
    },
]


def _mock_get(url, **kwargs):
    resp = MagicMock()
    resp.json.return_value = SAMPLE_RESPONSE
    resp.raise_for_status.return_value = None
    return resp


def test_fetch_jobs_returns_one_job_per_posting():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert len(jobs) == 2


def test_fetch_jobs_maps_title():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert jobs[0]["title"] == "Senior Frontend Engineer"


def test_fetch_jobs_maps_url():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert jobs[0]["url"] == "https://jobs.lever.co/vercel/abc-123"


def test_fetch_jobs_maps_company_from_slug():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert jobs[0]["company"] == "vercel"


def test_fetch_jobs_maps_location_from_categories():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert jobs[0]["location"] == "Remote"
    assert jobs[1]["location"] == "San Francisco"


def test_fetch_jobs_sets_platform_to_lever():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert all(j["platform"] == "lever" for j in jobs)


def test_fetch_jobs_uses_description_plain_as_snippet():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("vercel")

    assert "frontend engineer" in (jobs[0]["raw_snippet"] or "").lower()


def test_fetch_jobs_returns_empty_on_http_error():
    with patch("agents.discovery.platforms.lever.requests.get", side_effect=Exception("fail")):
        jobs = fetch_jobs("vercel")

    assert jobs == []


def test_fetch_jobs_returns_empty_on_non_list_response():
    def _mock(url, **kwargs):
        resp = MagicMock()
        resp.json.return_value = {"error": "not found"}
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_mock):
        jobs = fetch_jobs("vercel")

    assert jobs == []


def test_fetch_jobs_calls_correct_lever_api_url():
    captured = {}

    def _capture(url, **kwargs):
        captured["url"] = url
        resp = MagicMock()
        resp.json.return_value = []
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.lever.requests.get", side_effect=_capture):
        fetch_jobs("notion")

    assert captured["url"] == "https://api.lever.co/v0/postings/notion?mode=json"
