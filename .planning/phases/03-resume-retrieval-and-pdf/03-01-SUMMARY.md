---
phase: 03-resume-retrieval-and-pdf
plan: 01
subsystem: api
tags: [hono, postgres, resume-retrieval, vitest, api-key]

requires:
  - phase: 01-auth-profile-completion
    provides: X-API-Key middleware and shared httpError response helper
  - phase: 02-sse-pipeline-progress
    provides: established jobs route and Vitest pool.query mocking patterns
provides:
  - GET /jobs/:id/resumes for ordered resume version metadata
  - GET /jobs/:id/resume/:version_id for raw stored tailored source text
  - Cross-job resume version protection with uniform 404 behavior
affects: [03-resume-retrieval-and-pdf, frontend, telegram, pdf-rendering]

tech-stack:
  added: []
  patterns:
    - Hono jobs subroutes ordered before /:id/status and /:id catch-all routes
    - Two-query job existence check for list endpoint
    - Parameterized ownership predicate for raw source endpoint

key-files:
  created:
    - .planning/phases/03-resume-retrieval-and-pdf/03-01-SUMMARY.md
  modified:
    - api/src/routes/jobs.ts
    - api/src/routes/jobs.test.ts

key-decisions:
  - "Resume list distinguishes unknown jobs from existing jobs with zero versions by checking jobs first."
  - "Raw source endpoint returns resume_versions.latex_source unchanged as text/markdown for the locked compatibility contract."
  - "Cross-job version IDs use the same not_found response as missing versions to avoid leaking ownership."

patterns-established:
  - "Route ordering: specific /:id/resumes and /:id/resume/:version_id handlers must stay before /:id/status and /:id."
  - "Resume version reads use pool.query with $ placeholders only; route params are never interpolated into SQL."

requirements-completed: [RESUME-01, RESUME-04, RESUME-05]

duration: 3min
completed: 2026-05-14
---

# Phase 03 Plan 01: Resume Retrieval API Summary

**Authenticated resume metadata and raw tailored source retrieval through the existing Hono jobs API**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-14T15:33:16Z
- **Completed:** 2026-05-14T15:35:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `GET /jobs/:id/resumes`, returning ordered `resume_versions` metadata for existing jobs.
- Preserved the `200 []` contract for existing jobs with no resume versions while returning `404 not_found` for unknown jobs.
- Added `GET /jobs/:id/resume/:version_id`, returning raw stored `latex_source` with `text/markdown; charset=utf-8`.
- Enforced `WHERE job_id = $1 AND version_id = $2` for source retrieval so cross-job version IDs return a uniform 404.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add resume version list endpoint** - `aab7b43` (feat)
2. **Task 2: Add tailored Markdown endpoint with cross-job protection** - `cd9ba73` (feat)

## Files Created/Modified

- `api/src/routes/jobs.ts` - Added read-only resume metadata and raw source endpoints before the generic job routes.
- `api/src/routes/jobs.test.ts` - Added Vitest coverage for auth inheritance, metadata listing, empty lists, unknown jobs, raw source responses, and uniform cross-job 404s.
- `.planning/phases/03-resume-retrieval-and-pdf/03-01-SUMMARY.md` - Execution summary.

## Decisions Made

- Followed the plan's two-query list contract so a job with zero resume versions is not misclassified as missing.
- Kept raw source access independent of job approval status, matching D-10.
- Returned stored `latex_source` unchanged while exposing the backward-compatible `text/markdown` content type.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first auth inheritance test did not fail during RED because `/jobs/*` middleware already protected the mounted route group. This matched the planned GREEN behavior, so no route-local auth code was added.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `cd api && npm test -- src/routes/jobs.test.ts` - passed, 25 tests.
- `cd api && npm run build` - passed.
- Acceptance greps confirmed route presence, parameterized SQL predicates, `latex_source`, and `text/markdown; charset=utf-8`.

## Next Phase Readiness

The PDF rendering plan can now depend on authenticated access to stored resume source text and version metadata. No blockers from this plan.

## Self-Check: PASSED

- Found `api/src/routes/jobs.ts`
- Found `api/src/routes/jobs.test.ts`
- Found `.planning/phases/03-resume-retrieval-and-pdf/03-01-SUMMARY.md`
- Found commit `aab7b43`
- Found commit `cd9ba73`

---
*Phase: 03-resume-retrieval-and-pdf*
*Completed: 2026-05-14*
