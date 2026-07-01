from utils.ats_detect import ATSInfo, detect_ats


def test_detect_ats_returns_greenhouse_for_boards_url():
    assert detect_ats("https://boards.greenhouse.io/acme/jobs/12345") == ATSInfo(
        ats_type="greenhouse",
        board_token="acme",
        posting_id="12345",
    )


def test_detect_ats_returns_greenhouse_for_job_boards_url():
    assert detect_ats("https://job-boards.greenhouse.io/token/jobs/999") == ATSInfo(
        ats_type="greenhouse",
        board_token="token",
        posting_id="999",
    )


def test_detect_ats_returns_greenhouse_board_only():
    assert detect_ats("https://boards.greenhouse.io/acme") == ATSInfo(
        ats_type="greenhouse",
        board_token="acme",
        posting_id=None,
    )


def test_detect_ats_returns_lever():
    assert detect_ats("https://jobs.lever.co/myco/abc-123-def") == ATSInfo(
        ats_type="lever",
        board_token="myco",
        posting_id="abc-123-def",
    )


def test_detect_ats_returns_ashby():
    assert detect_ats("https://jobs.ashbyhq.com/startup/posting-uuid") == ATSInfo(
        ats_type="ashby",
        board_token="startup",
        posting_id="posting-uuid",
    )


def test_detect_ats_returns_unknown_for_linkedin():
    assert detect_ats("https://www.linkedin.com/jobs/view/123") == ATSInfo(
        ats_type="unknown",
        board_token=None,
        posting_id=None,
    )


def test_detect_ats_returns_unknown_for_empty_string():
    assert detect_ats("") == ATSInfo(
        ats_type="unknown",
        board_token=None,
        posting_id=None,
    )


def test_detect_ats_returns_unknown_for_workday():
    result = detect_ats("https://myco.wd1.myworkdayjobs.com/en-US/jobs")

    assert result.ats_type == "unknown"
