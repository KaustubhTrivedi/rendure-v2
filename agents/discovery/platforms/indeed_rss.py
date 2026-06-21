"""Indeed RSS feed client.

Indeed publishes an RSS feed for job searches at:
  https://www.indeed.com/rss?q={query}&l={location}&sort=date

This is intentionally public (like a news feed) and requires no authentication.
We do NOT use Indeed's scraping-prohibited HTML pages — only the RSS endpoint.
"""

import urllib.parse

import feedparser
import requests

from agents.discovery.types import DiscoveredJob

_RSS_BASE = "https://www.indeed.com/rss"
_SNIPPET_MAX = 400


def fetch_jobs(q: str, location: str = "") -> list[DiscoveredJob]:
    """Return jobs matching query *q* in *location* from Indeed's RSS feed.

    Returns an empty list (does not raise) on any error.
    """
    params = urllib.parse.urlencode({"q": q, "l": location, "sort": "date"})
    url = f"{_RSS_BASE}?{params}"

    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Rendure/1.0 job-discovery RSS reader"})
        resp.raise_for_status()
        feed = feedparser.parse(resp.content)
    except Exception:
        return []

    jobs: list[DiscoveredJob] = []
    for entry in feed.get("entries") or []:
        title = entry.get("title", "")
        link = entry.get("link", "")
        snippet = entry.get("summary", "") or entry.get("description", "")
        source = entry.get("source", {})
        company = source.get("title") if isinstance(source, dict) else None

        jobs.append(
            DiscoveredJob(
                url=link,
                title=title,
                company=company or "",
                location=None,
                platform="indeed",
                raw_snippet=snippet[:_SNIPPET_MAX] if snippet else None,
            )
        )
    return jobs
