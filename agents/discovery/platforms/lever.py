"""Lever job postings public API client.

Lever exposes a free, unauthenticated JSON endpoint:
  GET https://api.lever.co/v0/postings/{slug}?mode=json

Returns a JSON array of posting objects. No API key required.
"""

import requests

from agents.discovery.types import DiscoveredJob

_API_BASE = "https://api.lever.co/v0/postings"
_SNIPPET_MAX = 400


def fetch_jobs(company_slug: str) -> list[DiscoveredJob]:
    """Return all active postings for *company_slug* from Lever.

    Returns an empty list (does not raise) on any error.
    """
    url = f"{_API_BASE}/{company_slug}?mode=json"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    if not isinstance(data, list):
        return []

    jobs: list[DiscoveredJob] = []
    for item in data:
        snippet = item.get("descriptionPlain") or ""
        jobs.append(
            DiscoveredJob(
                url=item.get("hostedUrl", ""),
                title=item.get("text", ""),
                company=company_slug,
                location=(item.get("categories") or {}).get("location"),
                platform="lever",
                raw_snippet=snippet[:_SNIPPET_MAX] if snippet else None,
            )
        )
    return jobs
