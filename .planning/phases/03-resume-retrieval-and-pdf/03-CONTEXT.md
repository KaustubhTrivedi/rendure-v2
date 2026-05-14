# Phase 3: Resume Retrieval & PDF - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 adds three authenticated read endpoints under `/jobs/:id/...` to the existing Hono API:

- `GET /jobs/:id/resumes` — list resume versions for a job
- `GET /jobs/:id/resume/:version_id` — fetch the tailored Markdown for a version
- `GET /jobs/:id/resume/:version_id/pdf` — return a RenderCV-rendered PDF, served from a disk cache on repeat requests

All routes inherit the Phase 1 API key middleware mounted at `/jobs/*` and use the established `httpError()` RFC7807 hybrid error helper and pino logging. Resume content is read from `resume_versions` in the database (column `latex_source` holds Markdown — legacy column name preserved per CLAUDE.md §13). No Git branch checkouts; no file writes to `resume/` on the request path.

This phase does NOT cover: Telegram notifications (Phase 4), frontend UI, or any pipeline-altering behavior.

</domain>

<decisions>
## Implementation Decisions

### PDF Render Execution
- **D-01:** Invoke RenderCV via the `rendercv` CLI **directly on the host** — not Docker. This contradicts CLAUDE.md §10 and `README.md`; both must be updated as part of Phase 3 execution to reflect the host-CLI approach.
- **D-02:** PDF requests are **synchronous** — the HTTP request blocks until the cached PDF is returned or a fresh render completes. Cache hits return immediately; cache misses hold the connection while `rendercv` runs. Apply a render timeout (suggested 30s) returning 504 if exceeded.
- **D-03:** Each render uses a **per-request temp directory** created under the OS tmpdir (e.g., `mktemp -d` equivalent). Markdown is written there, `rendercv` is invoked against that path, the resulting PDF is moved atomically into the cache, and the temp directory is deleted in a `finally` block.
- **D-04:** A **process-wide concurrency cap** (default `N = 2`) limits in-flight renders. Excess requests queue. Make `N` configurable via env var (suggested: `RESUME_PDF_RENDER_CONCURRENCY`).

### Cache Layout & Dedupe
- **D-05:** Cache directory: `api/.cache/resumes/` inside the api package. Path is configurable via `RESUME_PDF_CACHE_DIR` env var. Must be added to `.gitignore`.
- **D-06:** Cache filename: `<version_id>.pdf`. `version_id` is a UUID and `resume_versions` is append-only, so the version_id is itself a sufficient cache key — no content hash needed.
- **D-07:** **In-process dedupe** for concurrent misses on the same `version_id`: keep an in-memory `Map<version_id, Promise<Buffer | path>>`. A second request for the same uncached version_id reuses the in-flight Promise. The entry is cleared on settle (resolve or reject). Combined with D-04 this prevents thundering-herd cold renders.
- **D-08:** **No eviction policy in v3.0.** Cache grows unbounded; PDFs are small and version count is bounded by `MAX_TAILORING_ITERATIONS × jobs`. Revisit only if disk usage becomes a real concern.

### Access Control & Version Gating
- **D-09:** `GET /jobs/:id/resumes` returns **all rows in `resume_versions` for that job_id**, regardless of `jobs.status`. This includes intermediate iterations from QA-failed loops. The list response is the base shape from RESUME-04: `version_id`, `version_number`, `created_at`, `tailoring_notes`. No QA score, no `is_active` flag — keep the endpoint focused.
- **D-10:** Markdown and PDF endpoints may be requested for **any `version_id` that exists** in `resume_versions` — not gated to the approved version. Authorization is satisfied by a valid API key alone.
- **D-11:** `:version_id` **must belong to `:id`**. The DB query is `WHERE job_id = $1 AND version_id = $2`. A version_id that exists under a different job returns 404, so URLs are self-validating and cross-job version IDs are not leaked.
- **D-12:** 404 cases (per RESUME-05): unknown `:id`, unknown `:version_id`, or `:version_id` not under `:id`. All return RFC7807 hybrid problem JSON via `httpError(c, 404, 'not_found', ...)`.

### Render Failure Semantics
- **D-13:** RenderCV non-zero exit / malformed Markdown / I/O failure returns **HTTP 500** with RFC7807 hybrid body, `type: 'render_failed'`. Body `detail` is a sanitized message — stderr is not echoed to the client.
- **D-14:** Server **probes `rendercv --version` at startup** and logs a pino `warn` if absent (do NOT fail startup — list and Markdown endpoints remain valuable without rendercv). PDF requests when `rendercv` is missing return **HTTP 503** with `type: 'rendercv_unavailable'`.
- **D-15:** Render failures are **never cached negatively** — every request retries. Failures are typically transient; persistent failures will be visible in logs.
- **D-16:** Logging: on render failure, log rendercv stderr truncated to ~1KB at pino `error`. On success, log only normal request-line info (no rendercv output). HTTP body never carries raw stderr.

### Content Types & Response Shapes
- **D-17:** Markdown endpoint returns `Content-Type: text/markdown; charset=utf-8`. Body is the raw `resume_versions.latex_source` column value.
- **D-18:** PDF endpoint returns `Content-Type: application/pdf` with the rendered bytes. Suggested headers: `Content-Length`, `Cache-Control: private, max-age=31536000, immutable` (version_id is immutable so long cache is safe). `Content-Disposition` is left to planning — default inline.
- **D-19:** List endpoint returns `application/json` with an array of version objects (per D-09). No envelope unless planning finds a strong reason to add one.

### Routing & Module Placement
- **D-20:** New routes live in `api/src/routes/jobs.ts` (existing module) unless planning finds the file is getting unwieldy, in which case a `api/src/routes/resumes.ts` split mounted under the same `/jobs` group is acceptable. Either way, the routes inherit `/jobs/*` API key middleware from `api/src/index.ts` and require no per-route auth code.
- **D-21:** Render logic and cache management go into a dedicated helper module (suggested: `api/src/resume-render.ts`), not inline in the route file. Lets tests target the render/cache layer directly.

### Testing
- **D-22:** Follow TDD with Vitest, mocking `pool.query` at the outer boundary (existing pattern in `api/src/routes/jobs.test.ts`).
- **D-23:** Render-layer tests mock the rendercv subprocess at the `child_process.spawn` / wrapper-function boundary — do not call real rendercv in unit tests. An optional integration test that actually invokes rendercv may be added but must be gated (e.g., skipped when `rendercv --version` fails).
- **D-24:** Required test coverage: API key inheritance, list returns all versions for job, list 404 on unknown job, Markdown returns correct content-type and body, Markdown 404 (unknown job, unknown version, version under different job), PDF cache miss writes to cache and returns bytes, PDF cache hit serves from disk without invoking renderer, in-process dedupe (two concurrent misses → one render), 503 when rendercv unavailable, 500 on render failure with sanitized body.

### Claude's Discretion
- Exact helper function names and the precise split between `resume-render.ts` and any cache helper.
- Whether to split routes into `api/src/routes/resumes.ts` or keep them in `jobs.ts` — researcher/planner decide based on current file size.
- Atomic-write mechanism for moving the rendered PDF into the cache (e.g., `rename` from same filesystem, or a `<version_id>.pdf.tmp` → `<version_id>.pdf` rename).
- Exact env var names beyond the suggestions above.
- Whether the in-process dedupe Map keys on `version_id` alone or `(job_id, version_id)` — both are valid given D-11.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Requirements
- `.planning/ROADMAP.md` — Phase 3 goal, dependency on Phase 1, and success criteria (5 success bullets).
- `.planning/REQUIREMENTS.md` — `RESUME-01` through `RESUME-05`.
- `.planning/PROJECT.md` — backend-first architecture, single API access point, pipeline agents and database schema constraints.
- `.planning/STATE.md` — current project state including Phase 1 and Phase 2 completion.

### Prior Phase Context
- `.planning/phases/01-auth-profile-completion/01-CONTEXT.md` — locked API key middleware, RFC7807 hybrid error shape, pino logging, Hono route module pattern, and TDD expectations.
- `.planning/phases/02-sse-pipeline-progress/02-CONTEXT.md` — established conventions for adding `/jobs/:id/...` routes, DB-as-source-of-truth, Vitest mocking patterns.

### Code and Schema
- `api/src/index.ts` — Hono app mount; `/jobs/*` API key middleware already applied here.
- `api/src/routes/jobs.ts` — existing jobs routes; default home for new resume routes.
- `api/src/routes/jobs.test.ts` — existing Vitest patterns and `pool.query` mocking.
- `api/src/errors.ts` — shared `httpError()` helper for RFC7807 hybrid errors. New error `type` strings: `render_failed`, `rendercv_unavailable`, `not_found`.
- `api/src/db.ts` — exported `pg.Pool`; reuse for `resume_versions` queries.
- `database/schema.sql` — `resume_versions` table (`version_id`, `job_id`, `version_number`, `git_branch`, `git_commit`, `latex_source` (Markdown), `tailoring_notes`, `created_at`).

### Project Conventions and Constraints
- `CLAUDE.md` §7 — `resume_versions` table reference (note `latex_source` holds Markdown).
- `CLAUDE.md` §9 — Resume Storage & Versioning (DB-only; no git branches).
- `CLAUDE.md` §10 — RenderCV Integration. **NOTE: §10 currently documents Docker invocation. D-01 changes this to host-CLI; CLAUDE.md §10 and `README.md` must be updated during Phase 3 execution.**
- `CLAUDE.md` §11 (TDD section) — Vertical-slice red-green-refactor; pytest equivalent here is Vitest.
- `.planning/phases/01-auth-profile-completion/01-CONTEXT.md` — RFC7807 hybrid error contract.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/src/db.ts` exports the shared `pool` — reuse for all `resume_versions` queries.
- `api/src/errors.ts` provides the RFC7807 `httpError()` helper. New `type` values introduced in this phase: `render_failed`, `rendercv_unavailable` (plus existing `not_found`).
- `api/src/routes/jobs.test.ts` already mocks `pool.query` — same pattern applies to resume route tests.
- `api/src/index.ts` already mounts API key middleware for `/jobs/*` — new routes inherit it.

### Established Patterns
- Hono route modules are mounted as grouped routers from `api/src/index.ts`.
- Route tests are co-located with source (`*.test.ts`) and use Vitest with outer-boundary mocking.
- Errors use JSON `application/json`, not strict `application/problem+json`.
- Request bodies and secrets are not logged in normal operation.
- `resume_versions.latex_source` holds **Markdown** content despite the column name (legacy artifact; DO NOT rename).

### Integration Points
- `resume_versions` rows are written by the Python `resume_tailor` agent — the API only reads from this table; no writes in this phase.
- `jobs.active_resume_id` points to the approved version once QA passes, but Phase 3 does NOT gate access on this — see D-09/D-10.
- `pipeline_events` is unrelated to resume retrieval and is not touched by this phase.

### New Surface Area
- New helper module suggested: `api/src/resume-render.ts` — encapsulates the rendercv subprocess invocation, temp dir lifecycle, cache lookup/write, and in-process dedupe Map.
- New cache directory: `api/.cache/resumes/` (gitignored).
- New env vars suggested: `RESUME_PDF_CACHE_DIR`, `RESUME_PDF_RENDER_CONCURRENCY`, `RESUME_PDF_RENDER_TIMEOUT_MS`.

</code_context>

<specifics>
## Specific Ideas

- The PDF cache key is the `version_id` UUID alone, justified by the immutability of `resume_versions` rows.
- The render path uses the host `rendercv` CLI — explicitly chosen over Docker despite the existing CLAUDE.md §10 guidance. Planning/execution must update CLAUDE.md §10 and README.md accordingly.
- All resume versions are listable and fetchable (not gated to approved), so debugging the QA-fail loop is possible directly from the API.
- The endpoints are designed to serve both a future web frontend and a Telegram bot consumer (per Phase 4 dependency).

</specifics>

<deferred>
## Deferred Ideas

- LRU / size-cap / time-based cache eviction — defer until cache size becomes a real operational concern.
- QA-score-per-version on the list endpoint — useful for debugging UX but out of RESUME-04 scope.
- `Content-Disposition: attachment; filename=...` and human-friendly download filenames — planning may add this; not a discussion decision.
- Async render endpoint (202 + poll) — only revisit if synchronous render p95 routinely exceeds a few seconds.
- Negative-cache for permanently broken Markdown — revisit only if log signal shows the same version_id repeatedly failing.
- Switching back to Docker-based rendercv — explicitly out, but documented here in case the host-CLI choice becomes operationally painful.
- Telegram bot wiring that uses these endpoints — Phase 4.

</deferred>

---

*Phase: 03-resume-retrieval-and-pdf*
*Context gathered: 2026-05-14*
