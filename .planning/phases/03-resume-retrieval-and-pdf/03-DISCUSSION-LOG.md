# Phase 3: Resume Retrieval & PDF — Discussion Log

**Discussed:** 2026-05-14
**Mode:** default (interactive, single-question turns)

This log is for human reference only. Downstream agents read `03-CONTEXT.md`.

---

## Area 1: PDF Render Execution Model

**Q1: How should the API invoke RenderCV to produce a PDF?**
Options:
- Shell `docker run` per request (recommended) — stateless, matches CLAUDE.md §10
- Long-running render sidecar container
- Direct `rendercv` CLI on host (no Docker)

**Selected:** Direct `rendercv` CLI on host (no Docker). _Contradicts CLAUDE.md §10; flagged for update during execution._

**Q2: Should the HTTP request block until the PDF is ready, or return async?**
Options:
- Synchronous, block until render finishes (recommended)
- Async — 202 + poll a render-job endpoint

**Selected:** Synchronous.

**Q3: Where should the temp working directory for each render live?**
Options:
- Per-render tmp dir under OS tmpdir, deleted after (recommended)
- Render inside the cache dir directly
- You decide

**Selected:** Per-render tmp dir under OS tmpdir.

**Q4: Should there be a render concurrency cap on the API process?**
Options:
- Cap concurrent renders to N (e.g. 2) with a queue (recommended)
- No cap — one docker per request
- You decide

**Selected:** Cap concurrent renders with a queue.

---

## Area 2: PDF Cache Layout & Dedupe

**Q1: Where should rendered PDFs be cached on disk?**
Options:
- `api/.cache/resumes/` inside the api package (recommended)
- `/var/cache/rendure/resumes/` or system-level path
- Project-root `cache/resumes/` shared with Python

**Selected:** `api/.cache/resumes/`.

**Q2: What's the filename scheme for cached PDFs?**
Options:
- `<version_id>.pdf` (recommended)
- `<version_id>-<content_hash>.pdf`
- `<job_id>/<version_number>.pdf`

**Selected:** `<version_id>.pdf`.

**Q3: How should concurrent requests for the same uncached PDF be handled?**
Options:
- In-process dedupe — share one render Promise per version_id (recommended)
- Lockfile on disk
- No dedupe — both render, last writer wins

**Selected:** In-process dedupe via shared Promise.

**Q4: Should there be a cache eviction / retention policy?**
Options:
- No eviction — cache grows unbounded (recommended for v3.0)
- LRU with size cap (e.g. 500MB)
- Time-based: delete files older than N days

**Selected:** No eviction in v3.0.

---

## Area 3: Access Control / Version Gating

**Q1: Which resume versions should `GET /jobs/:id/resumes` list?**
Options:
- All versions for the job, regardless of job status (recommended)
- Only the active/approved version
- All versions, but only when job is in a terminal state

**Selected:** All versions, regardless of status.

**Q2: Which versions can be fetched (Markdown + PDF) by ID?**
Options:
- Any version that exists in `resume_versions` (recommended)
- Only the job's `active_resume_id`
- Any version, but PDF only for approved

**Selected:** Any version that exists.

**Q3: Is `:version_id` required to belong to `:id`, or is it a global lookup?**
Options:
- Must match: version_id is only valid under its own job_id (recommended)
- Global — `:id` is informational, version_id alone is the lookup key

**Selected:** Must match — `WHERE job_id = $1 AND version_id = $2`.

**Q4: Should the list response include QA scores / pass status per version?**
Options:
- Just the base fields from RESUME-04 (recommended)
- Include latest qa_review per version (score, passed, gaps)
- Include a boolean `is_active` flag

**Selected:** Base fields only.

---

## Area 4: Render Failure Semantics

**Q1: When RenderCV fails, what HTTP status should the PDF endpoint return?**
Options:
- 500 with RFC7807 `render_failed` (recommended)
- 502 — RenderCV is an upstream tool
- 422 when failure is Markdown-source related, 500 otherwise

**Selected:** 500 `render_failed`.

**Q2: When `rendercv` is not installed at all, what should happen?**
Options:
- Detect at startup and warn; per-request 503 if still missing (recommended)
- Fail server startup if rendercv is missing
- Detect lazily per request; return 500 on first failure

**Selected:** Startup probe + warn + per-request 503.

**Q3: Should render failures be cached negatively?**
Options:
- Never cache failures — always retry (recommended)
- Short negative cache (e.g. 60s)
- Cache permanently on Markdown-structure errors only

**Selected:** Never cache failures.

**Q4: Should rendercv stderr/stdout be logged?**
Options:
- Log stderr truncated to ~1KB at pino `error` on failure, nothing on success (recommended)
- Always log full stderr+stdout regardless of outcome
- Log only exit code + duration; never stderr content

**Selected:** Truncated stderr on failure only.

---

## Deferred Ideas Surfaced

- Cache eviction (LRU / size cap / time-based).
- QA-score-per-version on the list endpoint.
- `Content-Disposition: attachment` with human-friendly filenames.
- Async render endpoint (202 + poll).
- Negative caching for permanently broken Markdown.
- Potential future switch back to Docker-based rendercv.
- Telegram bot wiring that consumes these endpoints (Phase 4).

## Claude's Discretion Items

- Helper function names and the precise split between route handlers, render helper, and cache helper.
- Whether to keep new routes in `jobs.ts` or split into `api/src/routes/resumes.ts`.
- Atomic-write mechanism for moving rendered PDFs into the cache.
- Exact env var names beyond the suggestions in CONTEXT.md.
- Whether the in-process dedupe Map keys on `version_id` alone or `(job_id, version_id)`.

## Notes / Cross-Cutting

- Direct-CLI choice (D-01) **requires** an update to `CLAUDE.md §10` and `README.md` as part of Phase 3 execution. Researcher/planner must include this as an explicit task.
