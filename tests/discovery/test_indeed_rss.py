"""Tests for the Indeed RSS feed client."""

from unittest.mock import MagicMock, patch

from agents.discovery.platforms.indeed_rss import fetch_jobs

SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Indeed Jobs</title>
    <item>
      <title><![CDATA[Senior Backend Engineer - Stripe]]></title>
      <link>https://www.indeed.com/viewjob?jk=abc123</link>
      <description><![CDATA[We are looking for a senior backend engineer...]]></description>
      <source url="https://stripe.com">Stripe</source>
    </item>
    <item>
      <title><![CDATA[Staff Engineer - Shopify]]></title>
      <link>https://www.indeed.com/viewjob?jk=def456</link>
      <description><![CDATA[Join Shopify as a staff engineer...]]></description>
      <source url="https://shopify.com">Shopify</source>
    </item>
  </channel>
</rss>"""


def _mock_get(url, **kwargs):
    resp = MagicMock()
    resp.content = SAMPLE_RSS.encode()
    resp.raise_for_status.return_value = None
    return resp


def test_fetch_jobs_returns_one_job_per_rss_item():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs(q="backend engineer", location="remote")

    assert len(jobs) == 2


def test_fetch_jobs_maps_title():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs(q="backend engineer", location="remote")

    assert "Senior Backend Engineer" in jobs[0]["title"]


def test_fetch_jobs_maps_url():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs(q="backend engineer", location="remote")

    assert "indeed.com" in jobs[0]["url"]
    assert "abc123" in jobs[0]["url"]


def test_fetch_jobs_maps_company_from_source_tag():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs(q="backend engineer", location="remote")

    assert jobs[0]["company"] == "Stripe"
    assert jobs[1]["company"] == "Shopify"


def test_fetch_jobs_sets_platform_to_indeed():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs(q="backend engineer", location="remote")

    assert all(j["platform"] == "indeed" for j in jobs)


def test_fetch_jobs_uses_description_as_snippet():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_mock_get):
        jobs = fetch_jobs(q="backend engineer", location="remote")

    assert "senior backend engineer" in (jobs[0]["raw_snippet"] or "").lower()


def test_fetch_jobs_returns_empty_on_http_error():
    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=Exception("fail")):
        jobs = fetch_jobs(q="engineer", location="remote")

    assert jobs == []


def test_fetch_jobs_includes_query_and_location_in_url():
    captured = {}

    def _capture(url, **kwargs):
        captured["url"] = url
        resp = MagicMock()
        resp.content = b"<?xml version='1.0'?><rss version='2.0'><channel></channel></rss>"
        resp.raise_for_status.return_value = None
        return resp

    with patch("agents.discovery.platforms.indeed_rss.requests.get", side_effect=_capture):
        fetch_jobs(q="software engineer", location="new york")

    assert "software+engineer" in captured["url"] or "software%20engineer" in captured["url"] or "software engineer" in captured["url"]
    assert "indeed.com" in captured["url"]
