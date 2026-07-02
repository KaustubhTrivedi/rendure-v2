---
phase: 18-automatic-application-submission
plan: 03
subsystem: greenhouse-portal
tags: [greenhouse, portal-agent, auto-apply, pytest, tdd]

requires:
  - phase: 18-automatic-application-submission
    plan: 01
    provides: ATS detection fields and application_submissions schema
  - phase: 18-automatic-application-submission
    plan: 02
    provides: AnswerEngine and RenderCV PDF rendering utility
provides:
  - Greenhouse Board API portal agent
  - Greenhouse portal implementation contract
  - TDD coverage for submission, failure, retry, DB writes, and temp cleanup
affects: [automatic-application-submission, greenhouse, portal-agents]

tech-stack:
  added: []
  patterns: [ephemeral-agent, parameterized-sql, httpx-boundary-mocks, temp-file-cleanup]

key-files:
  created:
    - agents/greenhouse_portal.py
    - agents/spec/greenhouse-portal.md
    - tests/test_greenhouse_portal.py
  modified: []

key-decisions:
  - "Greenhouse GET and POST use the public boards-api.greenhouse.io job endpoint."
  - "Silent accept is detected by requiring a top-level candidate id in the Greenhouse response."
  - "HTTP 5xx POST responses retry once after 5 seconds; other HTTP failures fail immediately."
  - "Submission failures write application_submissions status='failed' and jobs.status='submission_failed'."

requirements-completed: [GREENHOUSE-01]

completed: 2026-06-30
status: complete
---

# Phase 18-03: Greenhouse Portal Agent Summary

**Greenhouse Board API submission agent for opt-in automatic application submission**

## Accomplishments

- Added `agents.greenhouse_portal.run()` with the required `run(job_id, model, event_callback)` interface and local `AgentError`.
- Implemented Greenhouse question discovery, `AnswerEngine.lookup()` answer generation, multipart resume upload, single 5xx retry, and silent-accept failure detection.
- Added DB writes for validated status transitions, `application_submissions`, and `pipeline_events`.
- Added cleanup of temp PDF paths returned by the render boundary on both success and failure.
- Added the canonical Greenhouse portal spec.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED tests for greenhouse_portal.run()** - `2d02ee0` (test)
2. **Task 2: GREEN implementation and spec** - `0dd4a69` (feat)

**Plan metadata:** this SUMMARY commit

## Files Created/Modified

- `agents/greenhouse_portal.py` - Greenhouse portal agent implementation.
- `agents/spec/greenhouse-portal.md` - Canonical implementation contract.
- `tests/test_greenhouse_portal.py` - Ten behavior tests for Greenhouse submission.
- `.planning/phases/18-automatic-application-submission/18-03-SUMMARY.md` - This execution summary.

## Deviations from Plan

- Corrected a test harness typo after the RED commit: one failure-path assertion used the wrong `application_submissions` parameter index, and the shared mock helper installed single responses as `side_effect` instead of `return_value`. No product behavior changed.
- Used `uv run python` for the import verification because `python` is not available directly on PATH in this shell.
- Did not run `graphify update .` because the user explicitly limited scope ownership to the four 18-03 files and graph output would modify files outside that scope.

## Issues Encountered

- Existing unrelated worktree changes were present before and during execution:
  `.planning/STATE.md`, `.planning/ROADMAP.md`, `.agents/skills/scrapling-official/`, and `tests/test_ashby_portal.py`. They were left untouched and excluded from commits.

## Verification

- RED: `uv run pytest tests/test_greenhouse_portal.py --tb=short 2>&1 | grep -E "ERROR|FAILED|ImportError" | head -5` reported `ImportError` for `agents.greenhouse_portal`.
- GREEN: `uv run pytest tests/test_greenhouse_portal.py -v` passed: 10 passed, 2 warnings.
- Import: `uv run python -c "from agents.greenhouse_portal import run, AgentError; print('OK')"` printed `OK`.
- Greenhouse endpoint grep: `grep "boards-api.greenhouse.io" agents/greenhouse_portal.py` matched both URL constants.
- Submission table grep: `grep "application_submissions" agents/greenhouse_portal.py` matched the INSERT statement.

## User Setup Required

None for this slice. Runtime submission still depends on prior Phase 18 setup: migrated DB schema, populated `user_profile`, `answers.yaml`, and RenderCV availability.

## Next Phase Readiness

Lever and Ashby portal agents can follow the same tested agent shape: read approved resume and profile, render immediately before upload, write `application_submissions`, and enforce ATS-specific success semantics.

## Self-Check: PASSED

---
*Phase: 18-automatic-application-submission*
*Completed: 2026-06-30T11:36:25Z*
