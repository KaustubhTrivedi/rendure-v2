---
phase: 18-automatic-application-submission
plan: 04
subsystem: agents
tags: [lever, ats, application-submission, pytest, tdd]

requires:
  - phase: 18-01
    provides: application_submissions schema and submission status transitions
  - phase: 18-02
    provides: resume rendering utility used before portal upload
provides:
  - Lever portal agent for multipart application submission
  - TDD coverage for Lever success, retry, failure, cleanup, and DB writes
  - Canonical Lever portal implementation contract
affects: [automatic-application-submission, portal-router, orchestrator-auto-apply]

tech-stack:
  added: []
  patterns: [ephemeral portal agent, parameterized DB writes, boundary-mocked pytest tests]

key-files:
  created:
    - agents/lever_portal.py
    - agents/spec/lever-portal.md
    - tests/test_lever_portal.py
  modified: []

key-decisions:
  - "Lever 429 responses retry exactly once using Retry-After when present, defaulting to 60 seconds and capping at 120 seconds."
  - "HTTP 400 failures are not retried; 5xx responses get one 5 second retry."
  - "The agent writes failed application_submissions rows when the active resume version is known."

patterns-established:
  - "Portal agents render the active resume immediately before upload and clean temp PDF paths in finally."
  - "Tests assert status writes through SQL parameters rather than literal status strings."

requirements-completed: [LEVER-01]

duration: 55min
completed: 2026-06-30
status: complete
---

# Phase 18: Lever Portal Agent Summary

**Lever public Postings API submission with TDD coverage for multipart upload, retry policy, DB persistence, and temp PDF cleanup**

## Performance

- **Duration:** 55 min
- **Started:** 2026-06-30T21:55:00Z
- **Completed:** 2026-06-30T22:50:27Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `agents/lever_portal.py` with `run()` and `AgentError`, fixed Lever apply URL formatting, multipart payload construction, 429 Retry-After handling, 400 no-retry behavior, 5xx retry, and outcome persistence.
- Added `tests/test_lever_portal.py` with 11 TDD tests covering URL, success payload, retry paths, status transitions, HTTP failure, temp PDF cleanup, and `application_submissions` writes.
- Added `agents/spec/lever-portal.md` as the canonical Lever portal contract.

## Task Commits

1. **Task 1: RED - Write failing tests for lever_portal.run()** - `ccdffe7` (test)
2. **Task 2: GREEN - Implement agents/lever_portal.py and spec** - `bee3ff0` (feat)

**Plan metadata:** this summary commit.

## Files Created/Modified

- `agents/lever_portal.py` - Lever portal agent implementation.
- `agents/spec/lever-portal.md` - Canonical implementation contract.
- `tests/test_lever_portal.py` - Lever portal TDD coverage.
- `.planning/phases/18-automatic-application-submission/18-04-SUMMARY.md` - Plan close-out.

## Decisions Made

- Followed the plan's fixed Lever field set and did not add screening-question logic to this agent.
- Kept SQL values parameterized and adjusted test assertions to inspect query parameters for status updates.
- Implemented the threat-model retry cap: parseable Retry-After values are capped at 120 seconds.

## Deviations from Plan

### Auto-fixed Issues

**1. Missing read_first files**
- **Found during:** Task 1 and Task 2 read-first gates.
- **Issue:** `tests/test_greenhouse_portal.py` and `agents/greenhouse_portal.py` were referenced by the plan but did not exist in this checkout.
- **Fix:** Continued using the available required sources: `18-CONTEXT.md`, `agents/confirmation.py`, `utils/resume_render.py`, `database/010_application_submissions.sql`, and existing agent/test conventions.
- **Files modified:** None for this deviation.
- **Verification:** `rg --files | rg 'greenhouse|lever|portal|resume_render|010_application'` showed only discovery Greenhouse files and no portal implementation/test files.
- **Committed in:** N/A.

**2. Parameterized SQL status assertions**
- **Found during:** Task 2 GREEN verification.
- **Issue:** Two tests expected literal SQL strings like `status = 'submitted'`, while the implementation correctly uses parameterized status values.
- **Fix:** Updated those tests to assert status update parameters instead of literal SQL text.
- **Files modified:** `tests/test_lever_portal.py`.
- **Verification:** `uv run pytest tests/test_lever_portal.py -v` passed.
- **Committed in:** `bee3ff0`.

---

**Total deviations:** 2 auto-fixed.
**Impact on plan:** No scope expansion. The missing Greenhouse references were unavailable; Lever behavior was still implemented and verified against the explicit plan requirements.

## Issues Encountered

- Final test and import commands emit existing Pydantic deprecation warnings from `utils/llm.py`. They do not fail verification.
- The worktree had unrelated pre-existing dirty files: `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.agents/skills/scrapling-official/`. They were not staged or modified by this plan.

## User Setup Required

None - no new external service configuration or dependencies were added.

## Verification

- `uv run pytest tests/test_lever_portal.py -v` - PASSED, 11 tests passed, 2 existing warnings.
- `uv run python -c "from agents.lever_portal import run, AgentError; print('OK')"` - PASSED, printed `OK` with existing Pydantic warning.
- `grep "api.lever.co" agents/lever_portal.py` - PASSED, found `LEVER_APPLY_URL`.
- `grep "Retry-After" agents/lever_portal.py` - PASSED, found Retry-After header read logic.

## Next Phase Readiness

Lever portal behavior is ready for portal-router and Orchestrator auto-apply wiring. Integration work should verify the upstream ATS detection populates `jobs.ats_board_token` and `jobs.ats_posting_id` before spawning this agent.

## Self-Check: PASSED

---
*Phase: 18-automatic-application-submission*
*Completed: 2026-06-30*
