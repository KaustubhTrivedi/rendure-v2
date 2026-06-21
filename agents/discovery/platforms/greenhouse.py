"""Greenhouse job board public API client.

Greenhouse exposes a free, unauthenticated JSON endpoint for every company
that uses their hosted job board:
  GET https://api.greenhouse.io/v1/boards/{slug}/jobs

No API key required. Returns structured JSON — no scraping needed.
"""

import re
import requests

from agents.discovery.types import DiscoveredJob

_API_BASE = "https://api.greenhouse.io/v1/boards"
_SNIPPET_MAX = 400


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text).strip()


def _make_snippet(content: str | None) -> str | None:
    if not content:
        return None
    clean = " ".join(_strip_html(content).split())
    return clean[:_SNIPPET_MAX] if clean else None


def fetch_jobs(company_slug: str) -> list[DiscoveredJob]:
    """Return all active jobs for *company_slug* from Greenhouse.

    Returns an empty list (does not raise) on any network or parse error so
    one bad platform does not abort the full discovery run.
    """
    url = f"{_API_BASE}/{company_slug}/jobs"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    jobs: list[DiscoveredJob] = []
    for item in data.get("jobs") or []:
        jobs.append(
            DiscoveredJob(
                url=item.get("absolute_url", ""),
                title=item.get("title", ""),
                company=company_slug,
                location=(item.get("location") or {}).get("name"),
                platform="greenhouse",
                raw_snippet=_make_snippet(item.get("content")),
            )
        )
    return jobs
