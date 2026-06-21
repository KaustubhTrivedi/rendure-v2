"""Keyword-based relevance scoring for discovered jobs.

Intentionally lightweight — no LLM calls. Runs on every discovered job before
anything gets written to the DB, so it must be fast and cheap.

Score breakdown (all components 0.0–1.0, combined with weights):
  - Title match   0.50  — fraction of target_roles words found in job title
  - Keyword match 0.30  — fraction of keywords found in title + snippet
  - Location match 0.20 — 1.0 if any preferred location matches, else 0.0

An excluded company hard-blocks relevance regardless of score.
"""

from __future__ import annotations

import re

from agents.discovery.types import DiscoveredJob


def _normalise(text: str) -> str:
    return text.lower()


def _word_set(text: str) -> set[str]:
    return set(re.findall(r"\w+", _normalise(text)))


def _fraction_matched(needles: list[str], haystack: str) -> float:
    if not needles:
        return 0.0
    hay_words = _word_set(haystack)
    matched = sum(
        1
        for needle in needles
        if any(w in hay_words for w in _word_set(needle))
    )
    return matched / len(needles)


def score_job(job: DiscoveredJob, prefs: dict) -> float:
    """Return a relevance score [0.0, 1.0] for *job* given *prefs*.

    *prefs* should have the same keys as the search_preferences DB row.
    """
    target_roles: list[str] = prefs.get("target_roles") or []
    keywords: list[str] = prefs.get("keywords") or []
    preferred_locations: list[str] = prefs.get("locations") or []

    combined_text = f"{job['title']} {job.get('raw_snippet') or ''}"

    # Title match: best match across all target roles
    if target_roles:
        role_scores = [_fraction_matched(_word_set(role), job["title"]) for role in target_roles]
        title_score = max(role_scores)
    else:
        title_score = 0.5  # no preference = neutral

    # Keyword match against title + snippet
    kw_score = _fraction_matched(keywords, combined_text) if keywords else 0.5

    # Location match
    if preferred_locations and job.get("location"):
        loc_lower = _normalise(job["location"])
        loc_score = 1.0 if any(_normalise(loc) in loc_lower or loc_lower in _normalise(loc)
                                for loc in preferred_locations) else 0.0
    elif not preferred_locations:
        loc_score = 0.5  # no location preference = neutral
    else:
        loc_score = 0.0

    score = title_score * 0.50 + kw_score * 0.30 + loc_score * 0.20
    return round(min(max(score, 0.0), 1.0), 3)


def is_relevant(job: DiscoveredJob, prefs: dict, threshold: float = 0.40) -> bool:
    """Return True if *job* clears the relevance *threshold* and is not excluded."""
    excluded: list[str] = [c.lower() for c in (prefs.get("excluded_companies") or [])]
    if job["company"].lower() in excluded:
        return False
    return score_job(job, prefs) >= threshold
