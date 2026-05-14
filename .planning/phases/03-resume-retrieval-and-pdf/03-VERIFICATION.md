---
phase: 03-resume-retrieval-and-pdf
verified: 2026-05-14T16:21:14Z
status: passed
score: 16/16 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 14/16
  gaps_closed:
    - "The current RenderCV YAML input contract is validated before the PDF endpoint is treated as complete."
    - "`GET /jobs/:id/resume/:version_id/pdf` returns a rendered PDF via real RenderCV, not only a mocked subprocess."
  gaps_remaining: []
  regressions: []
---

# Phase 3: Resume Retrieval & PDF Verification Report

**Phase Goal:** A client can list the resume versions for any job, fetch the tailored Markdown/source of any version, and download a PDF rendered by RenderCV, with PDF rendering cached on disk so repeat downloads are instant.
**Verified:** 2026-05-14T16:21:14Z
**Status:** passed
**Re-verification:** Yes - after RenderCV contract fixture gap closure

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `GET /jobs/:id/resumes` returns the full version list for a job | VERIFIED | `api/src/routes/jobs.ts:300` defines the route; it checks job existence, queries `resume_versions WHERE job_id = $1`, orders by `version_number`, and returns rows. Tests cover ordered list at `api/src/routes/jobs.test.ts:597`. |
| 2 | Existing jobs with zero versions return `200 []` | VERIFIED | The list route returns `result.rows` directly; test at `api/src/routes/jobs.test.ts:649`. |
| 3 | Raw source endpoint returns stored source with `text/markdown` | VERIFIED | `api/src/routes/jobs.ts:327` defines the raw route; `api/src/routes/jobs.ts:332` selects `latex_source` by job/version ownership and returns `Content-Type: text/markdown; charset=utf-8`. Test at `api/src/routes/jobs.test.ts:672`. |
| 4 | Unknown job/version/cross-job IDs return 404 problem JSON | VERIFIED | List unknown job test at `api/src/routes/jobs.test.ts:660`; raw and PDF ownership queries use `WHERE job_id = $1 AND version_id = $2` at `api/src/routes/jobs.ts:332` and `api/src/routes/jobs.ts:354`. |
| 5 | PDF endpoint is authenticated through `/jobs/*` middleware | VERIFIED | `api/src/index.ts:34` applies `apiKeyMiddleware()` to `/jobs/*`; PDF auth test at `api/src/routes/jobs.test.ts:683`. |
| 6 | PDF route delegates to DB ownership check then render helper | VERIFIED | `api/src/routes/jobs.ts:349` defines the PDF route; `api/src/routes/jobs.ts:354` selects owned source and `api/src/routes/jobs.ts:362` calls `getOrRenderPdf({ versionId, source })`. |
| 7 | PDF route returns `application/pdf` with immutable cache headers on success | VERIFIED | `api/src/routes/jobs.ts:365` sets `application/pdf`; route test at `api/src/routes/jobs.test.ts:690`. |
| 8 | Cache hits return PDF bytes without invoking RenderCV | VERIFIED | `api/src/resume-render.ts:129-131` reads and returns cached bytes before validation/spawn; helper test at `api/src/resume-render.test.ts:88`. |
| 9 | Cache misses render through host `rendercv`, use temp dirs, and atomically cache PDFs | VERIFIED | `api/src/resume-render.ts:153-166` writes temp input, invokes `rendercv`, writes temp cache file, and renames to `<version_id>.pdf`; test at `api/src/resume-render.test.ts:173`. |
| 10 | Concurrent misses for the same version share one in-flight render | VERIFIED | `api/src/resume-render.ts:133-143` uses the `inFlight` map; test at `api/src/resume-render.test.ts:203`. |
| 11 | Different-version renders respect the concurrency cap | VERIFIED | Limiter implemented in `api/src/resume-render.ts:38-64`; tested at `api/src/resume-render.test.ts:228`. |
| 12 | RenderCV unavailable/timeout/failure responses are sanitized | VERIFIED | Route maps 503/504/500 at `api/src/routes/jobs.ts:369-387`; tests at `api/src/routes/jobs.test.ts:732`, `:749`, and `:769`; helper does not throw stderr in errors. |
| 13 | Missing RenderCV logs startup warning without blocking non-PDF routes | VERIFIED | Startup probe is non-test only and non-fatal at `api/src/index.ts:44-52`; availability helper tested at `api/src/resume-render.test.ts:101`. |
| 14 | Cache path is gitignored and documented | VERIFIED | `.gitignore` includes `api/.cache/resumes/`; `CLAUDE.md` and `README.md` document cache/env behavior. |
| 15 | Real RenderCV contract renders representative current YAML | VERIFIED | `api/src/resume-render.test.ts:120-157` runs real `rendercv --version`, real `rendercv render`, and asserts a PDF exists. Re-run result: `RUN_RENDERCV_CONTRACT_TEST=1 npm test -- src/resume-render.test.ts` passed with 10 tests. |
| 16 | PDF endpoint is proven to return a real RenderCV-rendered PDF | VERIFIED | Route/helper wiring is present and the real host RenderCV contract now passes; prior fixture gap fixed in commit `ebaa78b`. |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/src/routes/jobs.ts` | Resume list, raw source, and PDF routes | VERIFIED | Specific routes are before `/:id/status`; SQL is parameterized; PDF error mapping exists. |
| `api/src/routes/jobs.test.ts` | Route coverage for auth, list, raw source, PDF, and 404/error behavior | VERIFIED | Covers list, empty list, auth inheritance, raw source, PDF success, PDF 404/503/504/500. |
| `api/src/resume-render.ts` | RenderCV availability, cache, timeout, concurrency, dedupe | VERIFIED | Implements UUID cache paths, cache hit, temp render, atomic rename, timeout, limiter, and in-flight map. |
| `api/src/resume-render.test.ts` | Render helper coverage and gated real RenderCV contract | VERIFIED | Unit tests cover helper behavior; gated real RenderCV test now passes with representative YAML. |
| `api/src/index.ts` | Startup RenderCV availability probe | VERIFIED | Non-test startup logs warning and does not exit on missing RenderCV. |
| `.gitignore` | Runtime resume PDF cache ignored by git | VERIFIED | Contains `api/.cache/resumes/`. |
| `CLAUDE.md` | Host RenderCV CLI documentation | VERIFIED WITH WARNING | Documents host CLI/cache. Residual review warning remains: older Markdown QA/storage language still coexists with current RenderCV YAML runtime contract. |
| `README.md` | Client-facing resume retrieval docs | VERIFIED | Lists endpoints, API key requirement, host RenderCV CLI, cache path, env vars. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `api/src/index.ts` | `api/src/routes/jobs.ts` | `/jobs/*` middleware before route mount | VERIFIED | `api/src/index.ts:34` applies `apiKeyMiddleware()` before `app.route('/jobs', jobs)` at `api/src/index.ts:41`. |
| `api/src/routes/jobs.ts` | `resume_versions` | Job existence/list query | VERIFIED | `api/src/routes/jobs.ts:300-319` checks `jobs` first, then queries `resume_versions WHERE job_id = $1`. |
| `api/src/routes/jobs.ts` | `resume_versions` | Raw/PDF ownership query | VERIFIED | `api/src/routes/jobs.ts:332` and `api/src/routes/jobs.ts:354` use `WHERE job_id = $1 AND version_id = $2`. |
| `api/src/routes/jobs.ts` | `api/src/resume-render.ts` | PDF route calls render helper | VERIFIED | `api/src/routes/jobs.ts:362` calls `getOrRenderPdf({ versionId, source })`. |
| `api/src/resume-render.ts` | `api/.cache/resumes/<version_id>.pdf` | UUID-derived cache filename | VERIFIED | `api/src/resume-render.ts:81-85` validates UUID and derives `${versionId}.pdf`. |
| `api/src/resume-render.ts` | host `rendercv` | `spawn('rendercv', ...)` | VERIFIED | Availability probe at `api/src/resume-render.ts:122`; render command at `api/src/resume-render.ts:186`. |

Note: `gsd-tools verify key-links` still reports false negatives for several plan regexes because the stored regexes are over-escaped or invalid. Manual source checks above verify the links.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `api/src/routes/jobs.ts` list route | `result.rows` | `pool.query SELECT version_id... FROM resume_versions WHERE job_id = $1` | Yes | FLOWING |
| `api/src/routes/jobs.ts` raw route | `result.rows[0].latex_source` | `pool.query SELECT latex_source FROM resume_versions WHERE job_id = $1 AND version_id = $2` | Yes | FLOWING |
| `api/src/routes/jobs.ts` PDF route | `pdf` | DB `latex_source` passed to `getOrRenderPdf` | Yes | FLOWING |
| `api/src/resume-render.ts` cache hit | cached PDF bytes | `readFile(cachePath(versionId))` | Yes | FLOWING |
| `api/src/resume-render.ts` cache miss | rendered PDF bytes | host `rendercv render` output PDF | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Real RenderCV contract | `cd api && RUN_RENDERCV_CONTRACT_TEST=1 npm test -- src/resume-render.test.ts` | Re-run during verification: 1 file passed, 10 tests passed | PASS |
| Full API tests | `cd api && npm test` | Already run after gap fix: 91 passed, 1 skipped | PASS |
| Build | `cd api && npm run build` | Already run after gap fix: passed | PASS |
| Schema drift | `gsd-tools verify schema-drift 03` | Already run after gap fix: `drift_detected false` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RESUME-01 | 03-01 | Raw tailored source endpoint | SATISFIED | `api/src/routes/jobs.ts:327-341`; test `returns tailored source with text markdown content type`. Plan/context intentionally broadens "approved version" to any owned version. |
| RESUME-02 | 03-02, 03-03 | PDF endpoint returns rendered PDF | SATISFIED | PDF route/helper exist, route tests pass, and gated real RenderCV contract now passes. Docker wording in REQUIREMENTS is superseded by Phase 3 host-CLI decision. |
| RESUME-03 | 03-02, 03-03 | Disk cache and repeat downloads from cache | SATISFIED | Cache hit test proves no RenderCV spawn; helper derives `api/.cache/resumes/<version_id>.pdf`. |
| RESUME-04 | 03-01 | List version metadata | SATISFIED | `api/src/routes/jobs.ts:300-319`; tests cover ordered list and empty list. |
| RESUME-05 | 03-01, 03-03 | 404 for unknown job/version IDs | SATISFIED | Tests cover unknown job list, raw version/cross-job 404, and PDF version/cross-job 404. |

All Phase 3 requirement IDs from the prompt and plan frontmatter are accounted for. `.planning/REQUIREMENTS.md` maps only `RESUME-01..05` to Phase 3, so there are no orphaned Phase 3 requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `CLAUDE.md` | 530-595 | Older Markdown storage/QA contract remains beside current RenderCV YAML runtime contract | Warning | Advisory residual risk from code review: future agent work may follow Markdown docs and generate rows that fail PDF rendering. Does not block this phase because current phase behavior, docs for the API path, and the real RenderCV YAML contract are verified. |
| `api/src/index.ts` | 58 | `console.log` startup message | Info | Existing startup output pattern; not part of Phase 3 behavior. |

No production stubs, placeholder implementations, hardcoded empty rendered data, or orphaned phase artifacts were found in the modified source.

### Human Verification Required

None.

### Gaps Summary

No blocking gaps remain. The previous RenderCV contract gap was closed by commit `ebaa78b`, and the gated host RenderCV test now proves representative current YAML renders to a PDF through the real CLI. The client-facing list, raw source, and cached PDF download paths are implemented, wired, tested, and documented.

---

_Verified: 2026-05-14T16:21:14Z_
_Verifier: Claude (gsd-verifier)_
