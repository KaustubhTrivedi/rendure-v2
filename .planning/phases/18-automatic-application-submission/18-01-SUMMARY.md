---
phase: 18-automatic-application-submission
plan: 01
subsystem: database
tags: [postgres, ats-detection, pytest, tdd]

requires:
  - phase: 18-automatic-application-submission
    provides: Phase 18 context decisions for supported ATS URL patterns and submission schema
provides:
  - ATS URL detection for Greenhouse, Lever, Ashby, and unknown URLs
  - Migration 010 for ATS metadata columns, application submissions, and submission status transitions
affects: [portal-router, greenhouse-portal, lever-portal, ashby-portal, automatic-application-submission]

tech-stack:
  added: []
  patterns: [stdlib dataclass result object, module-level compiled regexes, additive guarded SQL migration]

key-files:
  created:
    - database/010_application_submissions.sql
    - utils/ats_detect.py
    - tests/utils/__init__.py
    - tests/utils/test_ats_detect.py
  modified: []

key-decisions:
  - "detect_ats returns a frozen ATSInfo dataclass with constrained ats_type values."
  - "Migration 010 adds only columns missing from the current schema and uses idempotent guards."

patterns-established:
  - "ATS detection uses module-level regexes in greenhouse, lever, ashby order."
  - "Submission schema records each submission against both job_id and resume version_id."

requirements-completed: [ATS-DETECT-01, DB-SCHEMA-01]

duration: 16min
completed: 2026-06-30
status: complete
---

# Phase 18: Automatic Application Submission Plan 01 Summary

**ATS detection utility and additive submission schema foundation for portal agents.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-06-30T11:03:00Z
- **Completed:** 2026-06-30T11:19:04Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added RED pytest coverage for Greenhouse, Lever, Ashby, LinkedIn, Workday, and empty URL detection behavior.
- Implemented `ATSInfo` and `detect_ats()` with stdlib-only module-level regexes.
- Added migration 010 with ATS fields on `jobs`, missing profile fields on `user_profile`, `application_submissions`, and three submission transitions.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED tests for detect_ats()** - `6cd170c` (test)
2. **Task 2: GREEN detect_ats() and migration 010** - `914b411` (feat)

**Plan metadata:** this summary commit.

## Files Created/Modified

- `tests/utils/__init__.py` - Test package marker mirroring `tests/__init__.py`.
- `tests/utils/test_ats_detect.py` - Eight behavior tests for ATS URL detection.
- `utils/ats_detect.py` - `ATSInfo` dataclass and `detect_ats(url)` implementation.
- `database/010_application_submissions.sql` - Idempotent additive migration for ATS submission support.

## Decisions Made

None - followed plan-specified URL patterns, dataclass shape, SQL columns, table schema, and allowed transitions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The advertised bundled TDD skill path was unavailable in this Codex session. Execution still followed the explicit TDD requirements from `AGENTS.md` and the plan.
- The plan-level `python -c` verification could not run because bare `python` is not on PATH. Re-ran the same check with `uv run python`, consistent with repo tooling.
- Pre-existing unrelated dirty files remained untouched: `.planning/ROADMAP.md`, `.planning/STATE.md`, and `.agents/skills/scrapling-official/`.
- Another worker added commit `a54b3b1` for 18-02 between the RED and GREEN 18-01 commits. No adjacent files from that worker were modified by this plan.

## Verification

- `uv run pytest tests/utils/test_ats_detect.py --tb=short 2>&1 | grep -E "ERROR|FAILED|ImportError" | head -5` - RED confirmed with ImportError during collection before implementation.
- `uv run pytest tests/utils/test_ats_detect.py -v` - PASS, 8 tests passed.
- `grep "application_submissions" database/010_application_submissions.sql` - PASS, returned `CREATE TABLE IF NOT EXISTS application_submissions`.
- `grep "approved.*submitting\|submitting.*submitted\|submitting.*submission_failed" database/010_application_submissions.sql` - PASS, returned all three transition rows.
- `uv run python -c "from utils.ats_detect import detect_ats; r = detect_ats('https://boards.greenhouse.io/acme/jobs/99'); assert r.ats_type == 'greenhouse'; print('OK')"` - PASS, returned `OK`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Portal-router and portal-agent plans can now import `utils.ats_detect` and depend on `application_submissions` plus the new submission status transitions.

## Self-Check: PASSED

---
*Phase: 18-automatic-application-submission*
*Completed: 2026-06-30*
