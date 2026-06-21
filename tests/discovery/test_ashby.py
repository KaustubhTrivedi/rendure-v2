"""Tests for the Ashby job board API client."""

from unittest.mock import MagicMock, patch

from agents.discovery.platforms.ashby import fetch_jobs


SAMPLE_RESPONSE = {
    "success": True,
    "results": [
        {
            "id": "job-aaa",
            "title": "Software Engineer, Backend",
            "jobUrl": "https://jobs.ashbyhq.com/linear/job-aaa",
            "locationName": "Remote",
            "descriptionHtml": "<p>We are building the future of project management...</p>",
        },
        {
            "id": "job-bbb",
            "title": "Product Designer",
            "jobUrl": "https://jobs.ashbyhq.com/linear/job-bbb",
            "locationName": "New York, NY",
            "descriptionHtml": None,
        },
    ],
}


def _mock_get(url, **kwargs):
    resp = MagicMock()
    resp.json.return_value = SAMPLE_RESPONSE
    resp.raise_for_status.return_value = None
    return resp


def test_fetch_jobs_returns_one_job_per_posting():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert len(jobs) == 2


def test_fetch_jobs_maps_title():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert jobs[0]["title"] == "Software Engineer, Backend"


def test_fetch_jobs_maps_url():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert jobs[0]["url"] == "https://jobs.ashbyhq.com/linear/job-aaa"


def test_fetch_jobs_maps_company_from_slug():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert jobs[0]["company"] == "linear"


def test_fetch_jobs_maps_location():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert jobs[0]["location"] == "Remote"
    assert jobs[1]["location"] == "New York, NY"


def test_fetch_jobs_sets_platform_to_ashby():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert all(j["platform"] == "ashby" for j in jobs)


def test_fetch_jobs_strips_html_from_description():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert "<p>" not in (jobs[0]["raw_snippet"] or "")
    assert "project management" in (jobs[0]["raw_snippet"] or "").lower()


def test_fetch_jobs_handles_null_description():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs("linear")

    assert jobs[1]["raw_snippet"] is None


def test_fetch_jobs_returns_empty_on_http_error():
    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=Exception("fail")):
        jobs = fetch_jobs("linear")

    assert jobs == []


def test_fetch_jobs_returns_empty_when_success_false():
    def _mock(url, **kwargs):
        resp = MagicMock()
        resp.json.return_value = {"success": False, "results": []}
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_mock):
        jobs = fetch_jobs("linear")

    assert jobs == []


def test_fetch_jobs_calls_correct_ashby_api_url():
    captured = {}

    def _capture(url, **kwargs):
        captured["url"] = url
        resp = MagicMock()
        resp.json.return_value = {"success": True, "results": []}
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.ashby.requests.get", side_effect=_capture):
        fetch_jobs("supabase")

    assert "supabase" in captured["url"]
