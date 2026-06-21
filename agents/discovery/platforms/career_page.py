"""Generic company career page scraper using Scrapling.

Used for company career pages that don't use Greenhouse/Lever/Ashby/Workday.
Strategy:
  1. Try a fast plain GET (Fetcher) — works for most static pages.
  2. On failure, fall back to StealthyFetcher (Cloudflare bypass).
  3. Extract all links that look like job postings using URL/text heuristics.

This scraper is intentionally conservative — it only reads publicly accessible
career pages. No authentication, no form submission.
"""

import re
import urllib.parse

from scrapling.fetchers import Fetcher, StealthyFetcher

from agents.discovery.types import DiscoveredJob

# Patterns that suggest a link points to a single job posting
_JOB_HREF_PATTERNS = [
    r"/job[s]?/",
    r"/careers?/",
    r"/opening[s]?/",
    r"/position[s]?/",
    r"/role[s]?/",
    r"/apply",
    r"\?jk=",
    r"\?gh_jid=",
    r"\?lever-origin=",
]

_JOB_TEXT_PATTERNS = [
    r"\bengineer\b",
    r"\bdeveloper\b",
    r"\bdesigner\b",
    r"\bmanager\b",
    r"\banalyst\b",
    r"\bscientist\b",
    r"\barchitect\b",
    r"\blead\b",
    r"\bdirector\b",
    r"\bspecialist\b",
]

_SNIPPET_MAX = 400
_MAX_LINKS = 100  # guard against pages with thousands of links


def _looks_like_job_link(href: str, text: str) -> bool:
    href_l = href.lower()
    text_l = text.lower()
    href_match = any(re.search(p, href_l) for p in _JOB_HREF_PATTERNS)
    text_match = any(re.search(p, text_l) for p in _JOB_TEXT_PATTERNS)
    return href_match and text_match


def _make_absolute(href: str, base_url: str) -> str:
    if href.startswith("http"):
        return href
    return urllib.parse.urljoin(base_url, href)


def fetch_jobs(page_url: str, company: str) -> list[DiscoveredJob]:
    """Scrape job links from *page_url* (a company careers page).

    Tries plain GET first, falls back to StealthyFetcher on failure.
    Returns an empty list (does not raise) on any error.
    """
    page = None
    try:
        page = Fetcher.get(page_url, timeout=20, stealthy_headers=True)
    except Exception:
        pass

    if page is None:
        try:
            page = StealthyFetcher.fetch(page_url, headless=True, timeout=30_000)
        except Exception:
            return []

    all_links = page.css("a[href]")[:_MAX_LINKS]

    jobs: list[DiscoveredJob] = []
    seen_urls: set[str] = set()

    for link in all_links:
        href = link.attrib.get("href", "")
        text = link.css("::text").get() or ""
        text = text.strip()

        if not href or not text:
            continue
        if not _looks_like_job_link(href, text):
            continue

        job_url = _make_absolute(href, page_url)
        if job_url in seen_urls:
            continue
        seen_urls.add(job_url)

        jobs.append(
            DiscoveredJob(
                url=job_url,
                title=text,
                company=company,
                location=None,
                platform="career_page",
                raw_snippet=None,
            )
        )
    return jobs
