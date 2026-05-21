---
phase: 04-telegram-bot-integration
plan: 01
subsystem: api
tags: [hono, typescript, child_process, tdd, pipeline]
requires: []
provides:
  - Shared submitJobUrl helper for POST /jobs and Telegram job intake
  - Discriminated result type for caller-friendly error mapping
  - TDD coverage for duplicate-check, insert, spawn, and error handling
affects:
  - 04-telegram-bot-integration (Plan 04-03 Telegram webhook imports helper)

tech-stack:
  added: []
  patterns:
    - "Discriminated union result type for route helper functions"
    - "Route → helper delegation: parse body → call helper → map result to HTTP"

key-files:
  created:
    - api/src/job-submission.ts
    - api/src/job-submission.test.ts
  modified:
    - api/src/routes/jobs.ts

key-decisions:
  - "Exported explicit types (JobSubmitResult, JobSubmitSuccess, etc.) downstream plans can import without inference scavenging"
  - "PROJECT_ROOT resolved relative to job-submission.ts location (api/src/ → api/ → project root) — one level shallower than routes/jobs.ts"
  - "400 error results carry errorCode + title for httpError mapping; 202/409 carry body for direct c.json"

patterns-established:
  - "Route handlers decompose into parse → call helper → map result"
  - "Helper functions return discriminated result types; never throw for expected errors"

requirements-completed: [TELEGRAM-01]

duration: 4min
completed: 2026-05-21
---

# Phase 04: Plan 01 Summary — Shared Job Submission Helper

**Extracted POST /jobs duplicate-check + insert + spawn logic into a reusable `submitJobUrl()` helper with TDD coverage, keeping the `/jobs` route behavior identical.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-21T15:12:55Z
- **Completed:** 2026-05-21T15:14:39Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Created `api/src/job-submission.ts` with `submitJobUrl(url)` and `statusUrl(jobId)` exports
- Represented all error paths as a discriminated union (`JobSubmitResult`) so callers never catch for expected bad input
- Delegated `POST /jobs` in `routes/jobs.ts` to the helper — 31 existing regression tests pass unchanged
- Added 6 new TDD tests covering: new submission, duplicate URL, invalid URL, empty URL, and spawn-error DB recovery
- TypeScript build passes cleanly with strict mode and `verbatimModuleSyntax`

## Task Commits

| Task | Type | Commit | Description |
|------|------|--------|-------------|
| 1 | test | `66347c6` | RED: failing tests for shared job submission helper |
| 1 | feat | `d13a8bb` | GREEN: implement shared `submitJobUrl` helper |
| 2 | refactor | `23678f3` | Delegate POST /jobs to shared helper |

**Plan metadata:** *(pending final metadata commit)*

_Note: Task 1 was TDD with two commits (RED → GREEN). Task 2 was REFACTOR with existing tests serving as the regression gate._

## Files Created/Modified

- `api/src/job-submission.ts` — Shared helper: URL validation, duplicate lookup, INSERT, spawn, async spawn error handler
- `api/src/job-submission.test.ts` — 6 TDD tests for all result paths
- `api/src/routes/jobs.ts` — POST /jobs refactored to delegate; all other routes unchanged

## Decisions Made

- **Three-commit TDD flow:** Test → implementation → refactor. The test file was committed first (RED commit) so the git log shows the full RED-GREEN-REFACTOR trace.
- **Explicit result types:** `JobSubmitResult` is a discriminated union (`statusCode` as discriminant) with four members — downstream Telegram code imports these types directly (Plan 04-03).
- **PROJECT_ROOT resolved from helper location:** `api/src/job-submission.ts` resolves `..` twice (src → api → project root), matching the current spawn behavior.
- **Route body-shape guard preserved:** The route still validates `body.url` is a non-empty string before delegating to the helper. This keeps the route responsible for HTTP-layer parsing, the helper for domain logic.

## Deviations from Plan

None — plan executed exactly as written.

**Total deviations:** 0
**Impact on plan:** N/A

## Issues Encountered

- Pre-existing `telegram.test.ts` failure in the working directory (Plan 04-03 workspace artifacts) — not related to this plan's changes. All route and helper tests pass.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 04-03 (Telegram webhook) can import `submitJobUrl` and `statusUrl` directly from `../job-submission.js`
- Exported types (`JobSubmitResult`, `JobSubmitSuccess`, `JobSubmitDuplicate`, `JobSubmitBadRequest`, `JobSubmitInternalError`) are stable and explicit
- Plan 04-02 (shared Telegram message helper) runs in parallel — no dependency on this plan

## Test Results

```
✓ Test Files  2 passed (2)
✓ Tests       37 passed (37)

→ src/job-submission.test.ts: 6 new tests
→ src/routes/jobs.test.ts:    31 regression tests
```

```
✓ Build: tsc passes with zero errors
```

## Self-Check: PASSED

- [x] All task files exist (api/src/job-submission.ts, api/src/job-submission.test.ts, api/src/routes/jobs.ts)
- [x] All commit hashes found (66347c6, d13a8bb, 23678f3)
- [x] Tests pass (2 files, 37 tests)
- [x] Build passes (tsc, zero errors)

---
*Phase: 04-telegram-bot-integration / Plan: 01*
*Completed: 2026-05-21*
