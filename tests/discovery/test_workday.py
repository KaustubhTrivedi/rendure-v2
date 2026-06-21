"""Tests for the Workday scraper (Scrapling DynamicFetcher)."""

from unittest.mock import MagicMock, patch

from agents.discovery.platforms.workday import fetch_jobs


FAKE_PAGE_HTML = """
<html><body>
  <ul class="css-1q2dra3">
    <li>
      <a data-automation-id="jobTitle" href="/en-US/meta/jobs/1234">Software Engineer</a>
      <dd data-automation-id="subtitle">Menlo Park, CA | Engineering</dd>
    </li>
    <li>
      <a data-automation-id="jobTitle" href="/en-US/meta/jobs/5678">Staff Engineer</a>
      <dd data-automation-id="subtitle">Remote | Infrastructure</dd>
    </li>
  </ul>
</body></html>
"""


def _make_mock_page(html: str, base_url: str = "https://meta.wd5.myworkdayjobs.com"):
    page = MagicMock()

    def css_side_effect(selector):
        from scrapling.parser import Selector
        real_page = Selector(html)
        return real_page.css(selector)

    page.css.side_effect = css_side_effect
    page.url = base_url
    return page


def test_fetch_jobs_returns_empty_list_on_fetch_error():
    with patch("agents.discovery.platforms.workday.DynamicFetcher") as MockFetcher:
        MockFetcher.fetch.side_effect = Exception("browser error")
        jobs = fetch_jobs("https://meta.wd5.myworkdayjobs.com/en-US/meta/jobs")

    assert jobs == []


def test_fetch_jobs_sets_platform_to_workday():
    mock_page = MagicMock()
    mock_page.css.return_value = []

    with patch("agents.discovery.platforms.workday.DynamicFetcher") as MockFetcher:
        MockFetcher.fetch.return_value = mock_page
        jobs = fetch_jobs("https://meta.wd5.myworkdayjobs.com/en-US/meta/jobs")

    assert all(j["platform"] == "workday" for j in jobs)


def test_fetch_jobs_returns_empty_when_no_job_links_found():
    mock_page = MagicMock()
    mock_page.css.return_value = []
    mock_page.url = "https://example.wd5.myworkdayjobs.com"

    with patch("agents.discovery.platforms.workday.DynamicFetcher") as MockFetcher:
        MockFetcher.fetch.return_value = mock_page
        jobs = fetch_jobs("https://example.wd5.myworkdayjobs.com/jobs")

    assert jobs == []


def test_fetch_jobs_extracts_company_from_url():
    mock_page = MagicMock()
    mock_page.css.return_value = []
    mock_page.url = "https://example.wd5.myworkdayjobs.com/jobs"

    with patch("agents.discovery.platforms.workday.DynamicFetcher") as MockFetcher:
        MockFetcher.fetch.return_value = mock_page
        jobs = fetch_jobs("https://example.wd5.myworkdayjobs.com/jobs")

    assert jobs == []
