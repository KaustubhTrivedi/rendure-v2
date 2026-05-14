---
phase: 03-resume-retrieval-and-pdf
plan: 03
subsystem: api
tags: [hono, rendercv, pdf-cache, vitest, documentation]

requires:
  - phase: 03-resume-retrieval-and-pdf
    provides: 03-01 resume metadata and raw source routes
  - phase: 03-resume-retrieval-and-pdf
    provides: 03-02 RenderCV render/cache helper
provides:
  - GET /jobs/:id/resume/:version_id/pdf for cached RenderCV PDF downloads
  - Startup RenderCV availability probe with non-fatal warning
  - Host RenderCV CLI and runtime cache documentation
affects: [telegram-downloads, frontend-resume-downloads, deployment]

tech-stack:
  added: []
  patterns:
    - Route-level PDF ownership query delegates to getOrRenderPdf
    - Sanitized RenderCV errors mapped to RFC7807 hybrid problem JSON
    - Non-test startup probes optional host dependencies without blocking server startup

key-files:
  created:
    - .planning/phases/03-resume-retrieval-and-pdf/03-03-SUMMARY.md
  modified:
    - api/src/index.ts
    - api/src/routes/jobs.ts
    - api/src/routes/jobs.test.ts
    - api/src/resume-render.ts
    - api/src/resume-render.test.ts
    - .gitignore
    - CLAUDE.md
    - README.md

key-decisions:
  - "PDF downloads use the existing /jobs/* API key middleware only; no route-local auth was added."
  - "RenderCV subprocess failures are mapped to sanitized client responses while raw stderr stays out of HTTP bodies."
  - "Host rendercv CLI is the documented Phase 3 render path; Docker rendering is no longer documented for API PDF downloads."

patterns-established:
  - "Keep resume PDF route before /:id/status and /:id catch-all routes."
  - "PDF routes must query resume_versions with WHERE job_id = $1 AND version_id = $2 before rendering."
  - "Renderer tests and route tests reset module-level render state when changing RESUME_PDF_* env vars."

requirements-completed: [RESUME-02, RESUME-03, RESUME-05]

duration: 6min
completed: 2026-05-14
---

# Phase 03 Plan 03: Resume PDF Route and Host RenderCV Summary

**Authenticated resume PDF download route backed by the RenderCV disk cache, startup availability probe, and host-CLI operational docs**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-14T15:40:13Z
- **Completed:** 2026-05-14T15:46:03Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `GET /jobs/:id/resume/:version_id/pdf`, returning `application/pdf` bytes with immutable private cache headers.
- Enforced cross-job protection with `SELECT latex_source FROM resume_versions WHERE job_id = $1 AND version_id = $2`.
- Mapped missing versions to 404, RenderCV unavailable to 503, render timeout to 504, and render failure to sanitized 500.
- Added a non-fatal startup probe that warns when host `rendercv` is unavailable outside test mode.
- Ignored `api/.cache/resumes/` and documented host RenderCV CLI, cache path, and `RESUME_PDF_*` env vars.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PDF route and error mapping** - `bbdb71c` (feat)
2. **Task 2: Add startup RenderCV probe and full phase verification** - `c9bda10` (feat)
3. **Task 3: Update cache ignore and host-CLI documentation** - `be6a657` (docs)

## Files Created/Modified

- `api/src/routes/jobs.ts` - Added the PDF endpoint, exact ownership query, immutable PDF headers, and sanitized RenderCV error mapping.
- `api/src/routes/jobs.test.ts` - Added PDF auth inheritance, successful render, cross-job 404, and 503/504/500 route coverage through the real render helper.
- `api/src/resume-render.ts` - Captured render timeout settings per render request to avoid mid-render env drift.
- `api/src/resume-render.test.ts` - Added `rendercv --version` probe failure coverage.
- `api/src/index.ts` - Added non-test startup RenderCV availability warning before `serve()`.
- `.gitignore` - Ignored the runtime PDF cache directory.
- `CLAUDE.md` - Replaced Docker PDF render guidance with host RenderCV CLI behavior and cache/env documentation.
- `README.md` - Documented resume retrieval endpoints, `X-API-Key`, host RenderCV requirement, cache path, and env vars.

## Decisions Made

- Kept auth inherited from the mounted `/jobs/*` middleware, matching the existing API key model.
- Returned no `Content-Disposition`; the route returns raw PDF bytes with stable cache headers as planned.
- Documented `latex_source` as a legacy column name while clarifying that current rows store RenderCV YAML and the raw source endpoint preserves its `text/markdown` compatibility contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Converted PDF response body to a typed Uint8Array**
- **Found during:** Task 2 full build verification
- **Issue:** TypeScript rejected passing Node `Buffer<ArrayBufferLike>` directly to `c.body()`.
- **Fix:** Converted the PDF `Buffer` to `Uint8Array.from(pdf)` before returning the Hono body.
- **Files modified:** `api/src/routes/jobs.ts`
- **Verification:** `cd api && npm run build` passed.
- **Committed in:** `c9bda10`

**2. [Rule 1 - Bug] Captured render timeout settings per render request**
- **Found during:** Task 2 full test verification
- **Issue:** Parallel Vitest files changed `RESUME_PDF_RENDER_TIMEOUT_MS`, allowing a render queued in one test to observe a later timeout value from another test.
- **Fix:** Captured `renderTimeoutMs()` when scheduling a render and passed the value through to the subprocess runner.
- **Files modified:** `api/src/resume-render.ts`, `api/src/routes/jobs.test.ts`
- **Verification:** Targeted route/render tests, full `npm test`, and `npm run build` passed.
- **Committed in:** `c9bda10`

---

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both fixes were required for correctness and build stability; no scope was added beyond the PDF route/probe contract.

## Issues Encountered

- The first full verification exposed the Hono body typing issue and a cross-file timeout-env race. Both were fixed and reverified.

## Known Stubs

None. Stub scan hits were documentation references to placeholder detection and the intentional sanitized RenderCV unavailable message.

## Threat Flags

None beyond the plan threat model. The new PDF route uses the mandated parameterized ownership query, route errors are sanitized, and filesystem/subprocess concerns remain behind the render helper.

## User Setup Required

The API host must have the `rendercv` CLI installed for PDF downloads. If missing, startup logs a warning and PDF requests return 503; non-PDF resume endpoints continue to work.

## Verification

- `cd api && npm test -- src/routes/jobs.test.ts src/resume-render.test.ts` - passed, 40 tests passed and 1 gated contract test skipped.
- `cd api && npm test` - passed, 91 tests passed and 1 gated contract test skipped.
- `cd api && npm run build` - passed.
- Acceptance greps confirmed route presence, PDF headers, sanitized error mappings, exact SQL predicate, startup warning, cache docs, and no Docker render instruction.

## Next Phase Readiness

Frontend and Telegram clients can now retrieve resume metadata, raw stored source, and cached PDFs through authenticated API endpoints. Deployment needs host `rendercv` installed and may optionally tune `RESUME_PDF_CACHE_DIR`, `RESUME_PDF_RENDER_CONCURRENCY`, and `RESUME_PDF_RENDER_TIMEOUT_MS`.

## Self-Check: PASSED

- Found created/modified files: `api/src/index.ts`, `api/src/routes/jobs.ts`, `api/src/routes/jobs.test.ts`, `api/src/resume-render.ts`, `api/src/resume-render.test.ts`, `.gitignore`, `CLAUDE.md`, `README.md`, `.planning/phases/03-resume-retrieval-and-pdf/03-03-SUMMARY.md`.
- Found task commits: `bbdb71c`, `c9bda10`, `be6a657`.

---
*Phase: 03-resume-retrieval-and-pdf*
*Completed: 2026-05-14*
