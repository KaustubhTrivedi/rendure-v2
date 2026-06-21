from typing import TypedDict


class DiscoveredJob(TypedDict):
    url: str
    title: str
    company: str
    location: str | None
    platform: str
    raw_snippet: str | None
