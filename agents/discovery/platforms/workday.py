"""Workday career portal scraper using Scrapling DynamicFetcher.

Workday sites are JS-rendered and have no public API. We use Scrapling's
DynamicFetcher (Playwright-backed) to render the page and extract job links.

Usage: pass the full Workday search URL, e.g.:
  https://meta.wd5.myworkdayjobs.com/en-US/Meta_University_Careers
  https://amazon.jobs/en/search  (Amazon uses a custom Workday fork)

Workday's HTML structure is relatively stable but may vary slightly between
tenants. We use multiple selector fallbacks to maximise compatibility.
"""

import re
import urllib.parse

from scrapling.fetchers import DynamicFetcher

from agents.discovery.types import DiscoveredJob

# Selectors for Workday job title links (in order of preference)
_TITLE_SELECTORS = [
    "a[data-automation-id='jobTitle']",
    "a.css-19uc56f",
    "li[class*='css'] a[href*='/jobs/']",
]

# Selectors for location/subtitle beneath each job
_SUBTITLE_SELECTORS = [
    "dd[data-automation-id='subtitle']",
    "dd.css-129m7dg",
    "span[data-automation-id='locations']",
]

_SNIPPET_MAX = 400


def _extract_company(url: str) -> str:
    """Best-effort company name from a Workday URL hostname."""
    host = urllib.parse.urlparse(url).hostname or ""
    # e.g. "stripe.wd5.myworkdayjobs.com" → "stripe"
    match = re.match(r"([^.]+)\.", host)
    return match.group(1) if match else host


def fetch_jobs(search_url: str) -> list[DiscoveredJob]:
    """Scrape job listings from a Workday career portal URL.

    Uses Scrapling's DynamicFetcher (Playwright) to render JS content.
    Returns an empty list (does not raise) on any error — one bad URL
    should not abort the full discovery run.
    """
    company = _extract_company(search_url)
    base_url = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(search_url))

    try:
        page = DynamicFetcher.fetch(
            search_url,
            headless=True,
            network_idle=True,
            disable_resources=True,
            timeout=45_000,
        )
    except Exception:
        return []

    # Try each selector until we find job links
    links = []
    for selector in _TITLE_SELECTORS:
        links = page.css(selector)
        if links:
            break

    jobs: list[DiscoveredJob] = []
    for link in links:
        title = link.css("::text").get() or link.attrib.get("aria-label", "")
        href = link.attrib.get("href", "")

        # Build absolute URL if href is relative
        job_url = href if href.startswith("http") else f"{base_url}{href}"

        # Try to grab subtitle (location) from a sibling element
        location: str | None = None
        parent = link.parent
        if parent:
            for sub_sel in _SUBTITLE_SELECTORS:
                sub = parent.css(sub_sel)
                if sub:
                    location = sub.css("::text").get()
                    break

        if not title or not job_url:
            continue

        jobs.append(
            DiscoveredJob(
                url=job_url,
                title=title.strip(),
                company=company,
                location=location,
                platform="workday",
                raw_snippet=None,
            )
        )
    return jobs
