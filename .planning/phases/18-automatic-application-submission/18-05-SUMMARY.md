---
phase: 18-automatic-application-submission
plan: 05
subsystem: ashby-portal
tags: [ashby, portal-agent, pytest, tdd, automatic-submission]

requires:
  - phase: 18-automatic-application-submission
    plan: 01
    provides: ATS metadata columns, application_submissions table, submission status transitions
  - phase: 18-automatic-application-submission
    plan: 02
    provides: RenderCV PDF rendering utility for portal agents
provides:
  - Ashby applicationForm.submit portal agent
  - Ashby portal canonical implementation contract
  - TDD coverage for Ashby success field handling, retries, status updates, submissions, and temp PDF cleanup
affects: [ashby-portal, automatic-application-submission]

tech-stack:
  added: []
  patterns: [ephemeral portal agent, parameterized SQL, multipart upload, success-field-gated RPC handling]

key-files:
  created:
    - agents/ashby_portal.py
    - agents/spec/ashby-portal.md
    - tests/test_ashby_portal.py
  modified: []

key-decisions:
  - "Ashby submission success is gated only by response_json.get('success') is True."
  - "HTTP 200 with success:false records a failed submission, moves jobs.status to submission_failed, and raises AgentError."
  - "Ashby resume upload uses multipart field _systemfield_resume as the v1 default pending live portal verification."

requirements-completed: [ASHBY-01]

completed: 2026-06-30
status: complete
---

# Phase 18-05: Ashby Portal Agent Summary

Implemented the Ashby portal agent for opt-in automatic application submission.

## Accomplishments

- Added 12 behavior tests for `ashby_portal.run()`.
- Implemented `agents/ashby_portal.py` with DB reads, status transition validation, RenderCV PDF rendering, Ashby multipart POST, single 5xx retry, success-field validation, application submission writes, pipeline events, and temp PDF cleanup.
- Added `agents/spec/ashby-portal.md` as the canonical implementation contract.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED tests for ashby_portal.run()** - `10d0068` (`test(18-05): add failing tests for ashby_portal.run()`)
2. **Task 2: GREEN implementation and spec** - `3066071` (`feat(18-05): implement ashby_portal agent`)

**Plan metadata:** this SUMMARY commit.

## Files Created/Modified

- `tests/test_ashby_portal.py` - 12 behavior tests for endpoint selection, `success` field handling, 5xx retry, status transitions, temp PDF cleanup, and `application_submissions` writes.
- `agents/ashby_portal.py` - Ashby portal agent implementation.
- `agents/spec/ashby-portal.md` - Ashby portal implementation contract.

## Verification

- `uv run pytest tests/test_ashby_portal.py --tb=short 2>&1 | grep -E "ERROR|FAILED|ImportError|ModuleNotFoundError" | head -5` - RED confirmed with `ModuleNotFoundError: No module named 'agents.ashby_portal'`.
- `uv run pytest tests/test_ashby_portal.py -v` - PASS, 12 tests passed, 2 existing pydantic warnings.
- `uv run pytest tests/test_ashby_portal.py -v 2>&1 | tail -20` - PASS, 12 tests passed, 2 existing pydantic warnings.
- `uv run python -c "from agents.ashby_portal import run, AgentError; print('OK')"` - PASS, printed `OK` with existing pydantic warning noise.
- `grep 'response_json.get.*"success"' agents/ashby_portal.py` - PASS, confirmed explicit success-field check.
- `grep 'api.ashbyhq.com' agents/ashby_portal.py` - PASS, returned the Ashby submit URL constant.

## Deviations from Plan

- The advertised local `tdd` skill file was not present in this Codex session, so execution followed the explicit TDD rules in `AGENTS.md` and the plan.
- `tests/test_greenhouse_portal.py` was missing at first read, then appeared concurrently from the 18-03 worker. I read the available concurrent file as the closest portal-agent reference and did not modify it.
- The RED tests initially over-constrained one status assertion to a literal SQL shape. The GREEN commit corrected that assertion to inspect behavior through recorded status updates so production SQL could remain parameterized.
- `graphify update .` was not run because the user's hard scope ownership limited changes to the Ashby agent, spec, test, and summary files.

## Concurrent Work Observed

- Pre-existing unrelated dirty files remained untouched: `.planning/ROADMAP.md`, `.planning/STATE.md`, and `.agents/skills/scrapling-official/`.
- Concurrent portal worker files/changes remained untouched: `tests/test_lever_portal.py`, `agents/lever_portal.py`, `agents/spec/lever-portal.md`.
- Concurrent commits landed during this plan, including `2d02ee0`, `0dd4a69`, and `ccdffe7`.

## Self-Check: PASSED

---
*Phase: 18-automatic-application-submission*
*Completed: 2026-06-30*
