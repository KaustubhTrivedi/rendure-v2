---
phase: 03-resume-retrieval-and-pdf
reviewed: 2026-05-14T15:49:21Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - .gitignore
  - CLAUDE.md
  - README.md
  - api/src/index.ts
  - api/src/resume-render.test.ts
  - api/src/resume-render.ts
  - api/src/routes/jobs.test.ts
  - api/src/routes/jobs.ts
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-14T15:49:21Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the Phase 03 resume retrieval and PDF rendering changes, including the Hono routes, RenderCV helper, tests, ignore rules, and public/project documentation. The API code uses parameterized SQL, validates cache keys before filesystem access, gates mounted routes behind `X-API-Key`, and has focused coverage for cache hits, render failures, timeouts, and route authorization.

One contract mismatch remains: Phase 03 introduces a renderer that rejects non-RenderCV YAML, while the project instructions still describe stored tailored resumes and QA validation as Markdown. That can send future Resume Tailor/QA work down the wrong format path and make PDF downloads fail for newly generated resumes.

Verification performed:

- `npm run build` in `api/` passed.
- `npm test` in `api/` passed: 8 files, 91 tests passed, 1 skipped.
- An attempted `npm test -- --runInBand` failed because Vitest does not support that Jest flag; rerun without the flag passed.

## Warnings

### WR-01: Resume source format contract is internally inconsistent

**File:** `CLAUDE.md:538`
**Issue:** Section 9 still says `resume_versions.latex_source` contains "Full tailored Markdown content", and lines 575-595 still define QA structure validation in terms of required Markdown sections and malformed Markdown. Phase 03's runtime renderer, however, explicitly rejects non-RenderCV YAML in `api/src/resume-render.ts:103-107`, and the updated Section 10 says current rows store RenderCV YAML. Future agent changes following the remaining Markdown instructions can store Markdown resumes that pass the documented contract but fail `GET /jobs/:id/resume/:version_id/pdf` with `render_failed`.
**Fix:** Pick one storage contract and make the docs, QA rules, Resume Tailor expectations, API content type, and renderer agree. If Phase 03 intends RenderCV YAML, update Section 9 and the structure rules to require RenderCV YAML fields instead of Markdown sections, and consider changing the raw source endpoint content type to YAML:

```ts
return c.text(result.rows[0].latex_source, 200, {
  'Content-Type': 'application/yaml; charset=utf-8',
})
```

If Markdown remains the intended source format, change `getOrRenderPdf` to render Markdown through the supported RenderCV path instead of rejecting non-YAML input.

---

_Reviewed: 2026-05-14T15:49:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
