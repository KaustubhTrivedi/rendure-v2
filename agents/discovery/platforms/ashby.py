"""Ashby job board public API client.

Ashby exposes a free, unauthenticated JSON endpoint:
  GET https://api.ashbyhq.com/posting-api/job-board?organizationHostedJobsPageName={slug}

Returns job postings with structured fields. No API key required.
"""

import re
import requests

from agents.discovery.types import DiscoveredJob

_API_BASE = "https://api.ashbyhq.com/posting-api/job-board"
_SNIPPET_MAX = 400


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text).strip()


def _make_snippet(html: str | None) -> str | None:
    if not html:
        return None
    clean = " ".join(_strip_html(html).split())
    return clean[:_SNIPPET_MAX] if clean else None


def fetch_jobs(company_slug: str) -> list[DiscoveredJob]:
    """Return all active postings for *company_slug* from Ashby.

    Returns an empty list (does not raise) on any error.
    """
    url = f"{_API_BASE}?organizationHostedJobsPageName={company_slug}"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    if not data.get("success"):
        return []

    jobs: list[DiscoveredJob] = []
    for item in data.get("results") or []:
        jobs.append(
            DiscoveredJob(
                url=item.get("jobUrl", ""),
                title=item.get("title", ""),
                company=company_slug,
                location=item.get("locationName"),
                platform="ashby",
                raw_snippet=_make_snippet(item.get("descriptionHtml")),
            )
        )
    return jobs
