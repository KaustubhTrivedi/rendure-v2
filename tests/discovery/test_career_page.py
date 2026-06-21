"""Tests for the generic company career page scraper."""

from unittest.mock import MagicMock, patch

from agents.discovery.platforms.career_page import fetch_jobs


def _make_page_mock(links_data):
    """Build a mock Scrapling page with controlled link elements."""
    page = MagicMock()
    mock_links = []
    for href, text in links_data:
        el = MagicMock()
        el.attrib = {"href": href}
        el.css.return_value.get.return_value = text
        mock_links.append(el)
    page.css.return_value = mock_links
    return page


def test_fetch_jobs_returns_empty_on_fetch_error():
    with patch("agents.discovery.platforms.career_page.Fetcher") as MockFetcher:
        MockFetcher.get.side_effect = Exception("network error")
        with patch("agents.discovery.platforms.career_page.StealthyFetcher") as MockStealth:
            MockStealth.fetch.side_effect = Exception("stealth error")
            jobs = fetch_jobs("https://stripe.com/jobs", company="Stripe")

    assert jobs == []


def test_fetch_jobs_sets_platform_to_career_page():
    page = MagicMock()
    page.css.return_value = []

    with patch("agents.discovery.platforms.career_page.Fetcher") as MockFetcher:
        MockFetcher.get.return_value = page
        jobs = fetch_jobs("https://stripe.com/jobs", company="Stripe")

    assert all(j["platform"] == "career_page" for j in jobs)


def test_fetch_jobs_sets_company_from_argument():
    page = MagicMock()
    page.css.return_value = []

    with patch("agents.discovery.platforms.career_page.Fetcher") as MockFetcher:
        MockFetcher.get.return_value = page
        jobs = fetch_jobs("https://stripe.com/jobs", company="Stripe")

    assert all(j["company"] == "Stripe" for j in jobs)


def test_fetch_jobs_returns_empty_when_no_job_links_found():
    page = MagicMock()
    page.css.return_value = []

    with patch("agents.discovery.platforms.career_page.Fetcher") as MockFetcher:
        MockFetcher.get.return_value = page
        jobs = fetch_jobs("https://stripe.com/jobs", company="Stripe")

    assert jobs == []


def test_fetch_jobs_falls_back_to_stealthy_on_plain_fetch_error():
    stealth_page = MagicMock()
    stealth_page.css.return_value = []

    with patch("agents.discovery.platforms.career_page.Fetcher") as MockFetcher:
        MockFetcher.get.side_effect = Exception("403")
        with patch("agents.discovery.platforms.career_page.StealthyFetcher") as MockStealth:
            MockStealth.fetch.return_value = stealth_page
            jobs = fetch_jobs("https://cloudflare-protected.com/jobs", company="CloudCo")

    assert jobs == []  # no links, but didn't raise
    MockStealth.fetch.assert_called_once()
