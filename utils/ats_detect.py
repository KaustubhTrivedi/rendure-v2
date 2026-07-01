from dataclasses import dataclass
import re


@dataclass(frozen=True)
class ATSInfo:
    ats_type: str
    board_token: str | None
    posting_id: str | None


GREENHOUSE_RE = re.compile(
    r"(?:boards|job-boards)\.greenhouse\.io/([^/?#]+)(?:/jobs/(\d+))?"
)
LEVER_RE = re.compile(r"jobs\.lever\.co/([^/?#]+)/([^/?#]+)")
ASHBY_RE = re.compile(r"jobs\.ashbyhq\.com/([^/?#]+)/([^/?#]+)")


def detect_ats(url: str) -> ATSInfo:
    greenhouse_match = GREENHOUSE_RE.search(url)
    if greenhouse_match:
        return ATSInfo(
            ats_type="greenhouse",
            board_token=greenhouse_match.group(1),
            posting_id=greenhouse_match.group(2),
        )

    lever_match = LEVER_RE.search(url)
    if lever_match:
        return ATSInfo(
            ats_type="lever",
            board_token=lever_match.group(1),
            posting_id=lever_match.group(2),
        )

    ashby_match = ASHBY_RE.search(url)
    if ashby_match:
        return ATSInfo(
            ats_type="ashby",
            board_token=ashby_match.group(1),
            posting_id=ashby_match.group(2),
        )

    return ATSInfo(ats_type="unknown", board_token=None, posting_id=None)
