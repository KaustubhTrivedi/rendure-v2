---
phase: 03-resume-retrieval-and-pdf
plan: 02
subsystem: api
tags: [hono, vitest, rendercv, pdf-cache, node-subprocess]

requires:
  - phase: 01-auth-profile-completion
    provides: Hono API conventions and Vitest test setup
provides:
  - RenderCV helper interface for PDF rendering
  - Disk PDF cache keyed by validated resume version UUID
  - In-flight render dedupe, timeout handling, and concurrency limiting
affects: [phase-03-resume-routes, telegram-downloads, frontend-resume-downloads]

tech-stack:
  added: []
  patterns:
    - Deep render/cache helper with public `getOrRenderPdf()` API
    - Vitest subprocess-boundary mocking for RenderCV
    - UUID-derived cache filenames with atomic temp-file rename

key-files:
  created:
    - api/src/resume-render.ts
    - api/src/resume-render.test.ts
  modified: []

key-decisions:
  - "Current PDF source contract is raw RenderCV YAML, not legacy Markdown."
  - "Render failures throw sanitized module errors and do not negative-cache failed output."
  - "Cold renders share one in-flight promise per version_id and queue through a process-wide limiter."

patterns-established:
  - "Validate `versionId` as UUID before deriving any filesystem path."
  - "Return cached immutable PDF bytes before invoking RenderCV."
  - "Write render output to a temporary cache path, then atomically rename to `<version_id>.pdf`."

requirements-completed: [RESUME-02, RESUME-03]

duration: 7min
completed: 2026-05-14
---

# Phase 03 Plan 02: Resume Render Helper Summary

**RenderCV PDF helper with UUID-safe disk caching, YAML source validation, in-flight dedupe, timeout handling, and concurrency limiting**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-14T15:30:00Z
- **Completed:** 2026-05-14T15:36:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `api/src/resume-render.ts` with `getOrRenderPdf()`, `checkRenderCvAvailable()`, typed render errors, and `resetResumeRendererForTests()`.
- Added UUID-only cache key validation and cache-hit reads from `RESUME_PDF_CACHE_DIR` or `api/.cache/resumes`.
- Enforced the current RenderCV YAML contract before subprocess execution: source must start with `cv:` and include root `design:`.
- Implemented cache-miss rendering through host `rendercv`, per-request temp dirs, atomic cache writes, timeout, concurrency cap, and in-flight dedupe.
- Added Vitest coverage for cache hit, unsafe IDs, gated host contract test, legacy source failure, cache miss render, dedupe, concurrency, timeout, and sanitized stderr.

## Task Commits

Each task was committed atomically:

1. **Task 1: Establish RenderCV contract and cache-hit behavior** - `0cd3a6f` (feat)
2. **Task 2: Implement synchronous render, timeout, concurrency cap, and dedupe** - `0848920` (feat)

## Files Created/Modified

- `api/src/resume-render.ts` - Deep module for RenderCV availability, source validation, cache lookup/write, subprocess execution, timeout, concurrency limiting, and in-flight dedupe.
- `api/src/resume-render.test.ts` - Vitest tests for the render/cache helper, including the optional `RUN_RENDERCV_CONTRACT_TEST=1` host RenderCV contract check.

## Decisions Made

- Kept tests focused on the public helper and mocked only `node:child_process.spawn`.
- Treated legacy Markdown as malformed for PDF rendering instead of converting it.
- Used Node built-ins only; no dependencies were added.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first Task 2 test run exposed a test harness bug where the fake child-process helper overwrote the dynamic spawn mock. Fixed the test utility and reran the focused test suite successfully.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. The planned filesystem and subprocess trust boundaries were implemented with UUID path validation, sanitized render errors, timeout, concurrency cap, and in-flight dedupe.

## User Setup Required

None for normal tests. The optional real RenderCV contract check still requires host `rendercv` and can be run with `RUN_RENDERCV_CONTRACT_TEST=1 npm test -- src/resume-render.test.ts`.

## Verification

- `cd api && npm test -- src/resume-render.test.ts` - passed, 8 tests passed and 1 gated contract test skipped.
- `cd api && npm run build` - passed.

## Next Phase Readiness

Plan 03 can wire the PDF route to `getOrRenderPdf()` and map `RenderCvUnavailableError`, `RenderCvFailedError`, and `RenderCvTimeoutError` to the planned HTTP responses.

## Self-Check: PASSED

- Found created files: `api/src/resume-render.ts`, `api/src/resume-render.test.ts`, `.planning/phases/03-resume-retrieval-and-pdf/03-02-SUMMARY.md`.
- Found task commits: `0cd3a6f`, `0848920`.

---
*Phase: 03-resume-retrieval-and-pdf*
*Completed: 2026-05-14*
