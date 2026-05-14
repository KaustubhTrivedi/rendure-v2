# Phase 03: resume-retrieval-and-pdf - Research

**Researched:** 2026-05-14
**Domain:** Hono API resume retrieval, RenderCV subprocess rendering, disk caching
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
- LRU / size-cap / time-based cache eviction — defer until cache size becomes a real operational concern.
- QA-score-per-version on the list endpoint — useful for debugging UX but out of RESUME-04 scope.
- `Content-Disposition: attachment; filename=...` and human-friendly download filenames — planning may add this; not a discussion decision.
- Async render endpoint (202 + poll) — only revisit if synchronous render p95 routinely exceeds a few seconds.
- Negative-cache for permanently broken Markdown — revisit only if log signal shows the same version_id repeatedly failing.
- Switching back to Docker-based rendercv — explicitly out, but documented here in case the host-CLI choice becomes operationally painful.
- Telegram bot wiring that uses these endpoints — Phase 4.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESUME-01 | `GET /jobs/:id/resume/:version_id` returns tailored resume Markdown for an approved version | Context decisions D-10/D-17 broaden this to any existing version and raw `latex_source`; DB query must enforce `job_id + version_id`. [VERIFIED: `.planning/phases/03-resume-retrieval-and-pdf/03-CONTEXT.md`, `database/schema.sql`] |
| RESUME-02 | `GET /jobs/:id/resume/:version_id/pdf` returns rendered PDF with `Content-Type: application/pdf` | Host `rendercv` CLI is locked, but RenderCV v2.8 documents YAML input and local Markdown smoke test failed; planner needs an early render-contract task. [CITED: https://docs.rendercv.com/user_guide/cli_reference/] [VERIFIED: `rendercv render --help`, local smoke test] |
| RESUME-03 | PDF rendering results cached on disk and re-served for same `version_id` | Use `api/.cache/resumes/<version_id>.pdf`, atomic rename, in-process Promise dedupe, no negative caching. [VERIFIED: `03-CONTEXT.md`] |
| RESUME-04 | `GET /jobs/:id/resumes` lists version metadata | Query `resume_versions` by `job_id`, returning `version_id`, `version_number`, `created_at`, `tailoring_notes`, ordered by version number. [VERIFIED: `database/schema.sql`, `03-CONTEXT.md`] |
| RESUME-05 | Resume endpoints return 404 for unknown job/version IDs | Use existing `httpError(c, 404, 'not_found', ...)`; version lookups must include `WHERE job_id = $1 AND version_id = $2`. [VERIFIED: `api/src/errors.ts`, `03-CONTEXT.md`] |
</phase_requirements>

## Summary

Phase 3 should be planned as two surfaces: simple read-only DB routes and a deeper render/cache helper. The API already mounts API-key middleware on `/jobs/*`, uses Hono route modules, uses `pool.query` directly, and returns RFC7807-hybrid JSON through `httpError()`. [VERIFIED: `api/src/index.ts`, `api/src/routes/jobs.ts`, `api/src/errors.ts`]

The main planning risk is RenderCV input format. Current project context says `resume_versions.latex_source` is Markdown and the endpoint must return `text/markdown`, but the installed `rendercv v2.8` CLI says `rendercv render` renders YAML input, and a direct local render attempt with Markdown exited non-zero. [VERIFIED: `agents/resume_tailor.py`, `rendercv --version`, `rendercv render --help`, local smoke test] [CITED: https://docs.rendercv.com/user_guide/cli_reference/]

**Primary recommendation:** Plan an initial vertical slice that proves the render helper can turn one real `latex_source` value into a PDF using host `rendercv`; if the source is Markdown, the plan must either add a tested conversion step or explicitly fail PDF requests with sanitized 500 until upstream resume output is corrected. [VERIFIED: local smoke test] [ASSUMED]

## Project Constraints (from CLAUDE.md)

- All inter-agent state passes through the database; API resume retrieval must read `resume_versions` and must not pass large resume payloads between agents. [VERIFIED: `CLAUDE.md` §2]
- `resume_versions.latex_source` is a legacy column name and stores resume content; do not rename it in this phase. [VERIFIED: `CLAUDE.md` §7/§9, `database/schema.sql`]
- The API should not write trigger-owned `jobs.qa_score` or `jobs.iteration_count`; Phase 3 is read-only against pipeline tables except filesystem cache writes. [VERIFIED: `CLAUDE.md` §7, `database/schema.sql`]
- Production code must be developed TDD, one vertical behavior at a time; task completion requires relevant tests green. [VERIFIED: `CLAUDE.md` §11, `.agents/skills/tdd/SKILL.md`]
- Use parameterized SQL only; do not string-interpolate IDs into queries. [VERIFIED: `CLAUDE.md` §11]
- Existing docs still describe Docker RenderCV; Phase 3 context D-01 requires updating `CLAUDE.md` §10 and `README.md` to host CLI. [VERIFIED: `CLAUDE.md` §10, `03-CONTEXT.md`]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | installed `^4.12.18`, registry `4.12.18` | HTTP routing and responses | Existing API framework. [VERIFIED: `api/package.json`, npm registry] |
| @hono/node-server | installed `^1.19.14`, registry `2.0.2` | Node HTTP server adapter | Existing production server entrypoint. [VERIFIED: `api/package.json`, npm registry] |
| pg | installed `^8.20.0`, registry `8.20.0` | PostgreSQL access | Existing `pool` abstraction. [VERIFIED: `api/package.json`, npm registry, `api/src/db.ts`] |
| pino | installed `^9.14.0`, registry `10.3.1` | Structured logging | Existing logger middleware uses pino. [VERIFIED: `api/package.json`, npm registry, `api/src/middleware/logger.ts`] |
| RenderCV CLI | installed `2.8` | PDF generation subprocess | Locked by D-01 as host CLI. [VERIFIED: `rendercv --version`, `03-CONTEXT.md`] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | installed `^4.1.5`, registry `4.1.6` | Unit/route tests | Existing route tests and TDD gate. [VERIFIED: `api/package.json`, npm registry] |
| Node built-ins: `fs/promises`, `os`, `path`, `child_process` | Node `v24.14.1` available locally | Temp dirs, atomic file writes, subprocess invocation | Avoid extra dependencies for cache/render helper. [VERIFIED: local `node --version`, Node built-in APIs assumed from runtime] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Host `rendercv` CLI | Docker `rendercv/rendercv` | Docker is out of scope by D-01 even though older requirements mention it. [VERIFIED: `03-CONTEXT.md`, `.planning/REQUIREMENTS.md`] |
| Disk cache | DB `BYTEA` PDF cache | Disk path is locked by D-05; DB cache was an archived v2.0 idea. [VERIFIED: `03-CONTEXT.md`, `.planning/phases/_archive-v2.0/01-api-foundation/01-CONTEXT.md`] |
| New queue/worker | Synchronous render with concurrency cap | Async render is deferred by context. [VERIFIED: `03-CONTEXT.md`] |

**Installation:**
```bash
cd api
npm install
# rendercv is an external host CLI; install outside npm if missing.
```

**Version verification:** `npm view hono version`, `npm view @hono/node-server version`, `npm view vitest version`, `npm view pino version`, `npm view pg version`, and `rendercv --version` were run on 2026-05-14. [VERIFIED: npm registry, local CLI]

## Architecture Patterns

### Recommended Project Structure
```text
api/src/
├── routes/
│   ├── jobs.ts              # Add resume list/markdown/pdf routes here unless split is needed
│   └── jobs.test.ts         # Route behavior tests using existing pool.query mocks
├── resume-render.ts         # RenderCV availability, cache lookup/write, dedupe, timeout
└── resume-render.test.ts    # Render/cache helper tests with subprocess mocked
api/.cache/resumes/          # Runtime cache, gitignored
```

### Pattern 1: Route Reads Stay Thin
**What:** Route handlers validate ownership through SQL, shape HTTP responses, and delegate PDF rendering to `resume-render.ts`. [VERIFIED: `api/src/routes/jobs.ts`, `03-CONTEXT.md`]
**When to use:** All three Phase 3 endpoints. [VERIFIED: `03-CONTEXT.md`]
**Example:**
```ts
const result = await pool.query(
  `SELECT latex_source
   FROM resume_versions
   WHERE job_id = $1 AND version_id = $2`,
  [jobId, versionId],
)
if (result.rows.length === 0) {
  return httpError(c, 404, 'not_found', 'Resume version not found.')
}
return c.body(result.rows[0].latex_source, 200, {
  'Content-Type': 'text/markdown; charset=utf-8',
})
```

### Pattern 2: Single-Flight Render Helper
**What:** `getOrRenderPdf({ jobId, versionId, source })` checks cache, joins an in-flight Promise if present, otherwise renders under a concurrency limiter and atomically writes `<version_id>.pdf`. [VERIFIED: `03-CONTEXT.md`]
**When to use:** PDF endpoint only. [VERIFIED: `03-CONTEXT.md`]
**Example:**
```ts
const inFlight = new Map<string, Promise<Buffer>>()

export async function getOrRenderPdf(versionId: string, source: string) {
  const cached = await readCachedPdf(versionId)
  if (cached) return cached
  const existing = inFlight.get(versionId)
  if (existing) return existing
  const promise = renderAndCache(versionId, source).finally(() => inFlight.delete(versionId))
  inFlight.set(versionId, promise)
  return promise
}
```

### Anti-Patterns to Avoid
- **Inline subprocess code in `jobs.ts`:** It makes timeout, dedupe, and cache tests brittle; use `resume-render.ts`. [VERIFIED: `03-CONTEXT.md`]
- **Checking `version_id` without `job_id`:** Leaks whether a version exists under another job; D-11 requires 404 for cross-job IDs. [VERIFIED: `03-CONTEXT.md`]
- **Negative-cache render failures:** D-15 forbids caching failures. [VERIFIED: `03-CONTEXT.md`]
- **Serving raw stderr to clients:** D-16 forbids raw stderr in HTTP bodies; log only truncated stderr. [VERIFIED: `03-CONTEXT.md`]
- **Assuming Markdown renders with RenderCV:** Current RenderCV CLI expects YAML input; Markdown input failed locally. [VERIFIED: `rendercv render --help`, local smoke test] [CITED: https://docs.rendercv.com/user_guide/cli_reference/]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP routing/errors | Custom router or ad hoc error JSON | Existing Hono routes and `httpError()` | Consistent auth and RFC7807-hybrid shape already exist. [VERIFIED: `api/src/index.ts`, `api/src/errors.ts`] |
| Database access | String-built SQL or new DB client | Existing `pool.query` with parameters | Project convention and injection prevention. [VERIFIED: `api/src/db.ts`, `CLAUDE.md`] |
| PDF rendering engine | Custom Markdown-to-PDF renderer | RenderCV CLI per D-01 | RenderCV is the locked renderer despite input-format risk. [VERIFIED: `03-CONTEXT.md`] |
| Concurrency primitives | Complex queue service | Small in-process limiter plus Promise map | Phase is single-process self-hosted and D-04/D-07 only require process-wide behavior. [VERIFIED: `03-CONTEXT.md`] |
| Cache invalidation | LRU/TTL/cache sweeper | Immutable `version_id` filename, no eviction | Eviction is deferred and `resume_versions` is append-only. [VERIFIED: `03-CONTEXT.md`, `database/schema.sql`] |

**Key insight:** The render/cache helper is the only deep module in this phase; keep route handlers boring and push filesystem/subprocess complexity behind one tested interface. [VERIFIED: current route patterns] [ASSUMED]

## Common Pitfalls

### Pitfall 1: RenderCV Input Format Mismatch
**What goes wrong:** The implementation writes raw Markdown to a temp `.md` file and calls `rendercv render`, but RenderCV exits non-zero. [VERIFIED: local smoke test]
**Why it happens:** RenderCV v2.8 CLI documents `rendercv render` as rendering a YAML input file. [CITED: https://docs.rendercv.com/user_guide/cli_reference/] [VERIFIED: `rendercv render --help`]
**How to avoid:** Plan a Wave 0 render-contract test using a real `latex_source` sample; if current source is Markdown, either add a tested conversion layer or require upstream resume output to become RenderCV YAML. [ASSUMED]
**Warning signs:** `rendercv render` stderr mentions YAML parsing/validation and no PDF appears in the output folder. [VERIFIED: local smoke test]

### Pitfall 2: Cross-Job Version Leakage
**What goes wrong:** A client can infer a `version_id` exists under another job. [VERIFIED: `03-CONTEXT.md`]
**Why it happens:** Querying by `version_id` alone. [VERIFIED: `03-CONTEXT.md`]
**How to avoid:** Always query `WHERE job_id = $1 AND version_id = $2`. [VERIFIED: `03-CONTEXT.md`]
**Warning signs:** Tests for "version under different job" return 200 or a distinct error. [VERIFIED: `03-CONTEXT.md`]

### Pitfall 3: Cache Race Produces Partial PDFs
**What goes wrong:** Concurrent readers see a half-written PDF file. [ASSUMED]
**Why it happens:** Writing directly to `<version_id>.pdf` instead of writing temp then renaming. [ASSUMED]
**How to avoid:** Render into per-request temp dir, then `rename` the completed PDF into `api/.cache/resumes/<version_id>.pdf` on the same filesystem. [VERIFIED: `03-CONTEXT.md`] [ASSUMED]
**Warning signs:** Intermittent invalid PDFs on concurrent requests. [ASSUMED]

### Pitfall 4: Test Pollution from Global In-Flight Map
**What goes wrong:** One test's in-flight Promise or cache path affects another test. [ASSUMED]
**Why it happens:** Module-level Map and default cache dir persist across tests. [ASSUMED]
**How to avoid:** Export a test-only reset or create renderer instances with injected cache dir, spawn function, logger, and limiter. [ASSUMED]
**Warning signs:** Route tests pass alone but fail in full suite. [ASSUMED]

## Code Examples

### RenderCV CLI Shape
```bash
rendercv --version
rendercv render input.yaml --output-folder "$tmp/out" --pdf-path resume.pdf --quiet
```
Source: RenderCV CLI reference and local `rendercv render --help`. [CITED: https://docs.rendercv.com/user_guide/cli_reference/] [VERIFIED: local CLI]

### Sanitized Render Failure
```ts
logger.error({ err: stderr.slice(0, 1024), version_id: versionId }, 'RenderCV failed')
return httpError(c, 500, 'internal_error', 'PDF render failed.', {
  type: 'render_failed',
  detail: 'RenderCV failed to produce a PDF for this resume version.',
})
```
Source: Phase context D-13/D-16 and existing `httpError()` helper. [VERIFIED: `03-CONTEXT.md`, `api/src/errors.ts`]

### Cache Hit Response Headers
```ts
return c.body(pdfBytes, 200, {
  'Content-Type': 'application/pdf',
  'Content-Length': String(pdfBytes.byteLength),
  'Cache-Control': 'private, max-age=31536000, immutable',
})
```
Source: Phase context D-18. [VERIFIED: `03-CONTEXT.md`]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Docker `rendercv/rendercv` manual/export path | Host `rendercv` CLI inside API request path | Locked in Phase 3 discussion on 2026-05-14 | Update `CLAUDE.md` and `README.md`; do not plan Docker work. [VERIFIED: `03-CONTEXT.md`] |
| Git-branch tailored resumes | DB-only `resume_versions.latex_source` | Current schema comments and Resume Tailor insert NULL git fields | API reads DB content only; no checkout or `resume/` writes. [VERIFIED: `database/schema.sql`, `agents/resume_tailor.py`] |
| v2.0 archived DB PDF bytes cache | Disk cache in `api/.cache/resumes` | Locked in Phase 3 discussion | Add `.gitignore`; no DB migration for cache. [VERIFIED: `03-CONTEXT.md`] |

**Deprecated/outdated:**
- `CLAUDE.md` §10 Docker RenderCV instructions are outdated for Phase 3 and must be updated. [VERIFIED: `CLAUDE.md`, `03-CONTEXT.md`]
- `.planning/REQUIREMENTS.md` still says "via RenderCV in Docker", superseded by Phase 3 D-01. [VERIFIED: `.planning/REQUIREMENTS.md`, `03-CONTEXT.md`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | If current source is Markdown, a conversion layer or upstream format correction is required for RenderCV PDF generation. | Summary, Pitfalls | PDF endpoint may be unimplementable as specified without extra scope. |
| A2 | Route handlers should stay thin and render/cache should be a deep helper module. | Architecture, Don't Hand-Roll | Minor maintainability risk; tests could still pass with inline implementation. |
| A3 | Atomic rename from temp dir prevents partial PDF reads. | Common Pitfalls | Incorrect filesystem assumptions could leave race conditions. |
| A4 | Renderer instance injection/reset is the best way to avoid test pollution. | Common Pitfalls | Tests may need a simpler reset strategy depending on final design. |

## Open Questions

1. **Can the actual `resume_versions.latex_source` values be rendered by RenderCV v2.8?**
   - What we know: Existing output sample is Markdown, `agents/resume_tailor.py` prompt asks for RenderCV YAML in places, and RenderCV CLI expects YAML input. [VERIFIED: `output/.../resume.md`, `agents/resume_tailor.py`, local CLI]
   - What's unclear: The live DB may contain Markdown or YAML depending on when rows were produced. [ASSUMED]
   - Recommendation: Planner should add first task: create a fixture from a real/current resume version and prove render success or failure before implementing cache details. [ASSUMED]

2. **Should `Content-Disposition` be inline or attachment?**
   - What we know: D-18 leaves it to planning and defaults inline. [VERIFIED: `03-CONTEXT.md`]
   - What's unclear: Future Telegram/client UX filename requirements. [ASSUMED]
   - Recommendation: Use inline with no custom filename unless planner wants a small additive header. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | API build/test/runtime | yes | v24.14.1 | none needed. [VERIFIED: local CLI] |
| npm | API dependency/test commands | yes | 11.12.1 | none needed. [VERIFIED: local CLI] |
| RenderCV CLI | PDF endpoint | yes | RenderCV v2.8 | PDF endpoint returns 503 if unavailable per D-14. [VERIFIED: local CLI, `03-CONTEXT.md`] |
| uv | Existing Python pipeline, not Phase 3 runtime | yes | 0.9.18 | none needed for Phase 3. [VERIFIED: local CLI] |
| Docker | Outdated docs only | yes | 29.4.0 | Not used in Phase 3. [VERIFIED: local CLI, `03-CONTEXT.md`] |
| psql/PostgreSQL client | Manual DB inspection/migrations | yes | psql 17.7 | API uses `pg` at runtime. [VERIFIED: local CLI, `api/src/db.ts`] |

**Missing dependencies with no fallback:** None found. [VERIFIED: local CLI]

**Missing dependencies with fallback:** RenderCV absence is handled at request time with 503 by D-14. [VERIFIED: `03-CONTEXT.md`]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest installed `^4.1.5`; registry latest observed `4.1.6`. [VERIFIED: `api/package.json`, npm registry] |
| Config file | none detected; Vitest uses defaults. [VERIFIED: `find api ...`] |
| Quick run command | `cd api && npm test -- src/routes/jobs.test.ts src/resume-render.test.ts` [VERIFIED: package script] |
| Full suite command | `cd api && npm test` [VERIFIED: package script] |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| RESUME-01 | Markdown endpoint returns raw `latex_source` with `text/markdown; charset=utf-8` | route/unit | `cd api && npm test -- src/routes/jobs.test.ts` | yes, extend file. [VERIFIED: `api/src/routes/jobs.test.ts`] |
| RESUME-02 | PDF endpoint returns `application/pdf` bytes on render success | route + helper/unit | `cd api && npm test -- src/routes/jobs.test.ts src/resume-render.test.ts` | helper test missing. [VERIFIED: file scan] |
| RESUME-03 | Cache hit avoids subprocess; concurrent miss dedupes render | helper/unit | `cd api && npm test -- src/resume-render.test.ts` | no, Wave 0 add. [VERIFIED: file scan] |
| RESUME-04 | List endpoint returns all version rows for job | route/unit | `cd api && npm test -- src/routes/jobs.test.ts` | yes, extend file. [VERIFIED: `api/src/routes/jobs.test.ts`] |
| RESUME-05 | Unknown job/version/cross-job version returns 404 problem JSON | route/unit | `cd api && npm test -- src/routes/jobs.test.ts` | yes, extend file. [VERIFIED: `api/src/routes/jobs.test.ts`] |

### Sampling Rate
- **Per task commit:** `cd api && npm test -- src/routes/jobs.test.ts src/resume-render.test.ts` [ASSUMED]
- **Per wave merge:** `cd api && npm test` [VERIFIED: package script]
- **Phase gate:** `cd api && npm test` plus a gated/manual render-contract check if real RenderCV input is available. [ASSUMED]

### Wave 0 Gaps
- [ ] `api/src/resume-render.test.ts` — covers RESUME-02 and RESUME-03 render/cache helper. [VERIFIED: file scan]
- [ ] Extend `api/src/routes/jobs.test.ts` — covers RESUME-01, RESUME-04, RESUME-05 and API-key inheritance. [VERIFIED: existing file]
- [ ] Render-contract fixture/test — proves current resume source can render with `rendercv v2.8`, skipped when CLI unavailable. [VERIFIED: local input mismatch]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing `X-API-Key` middleware on `/jobs/*`. [VERIFIED: `api/src/index.ts`, `api/src/middleware/apiKey.ts`] |
| V3 Session Management | no | Single API key, no sessions in v3.0. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| V4 Access Control | yes | Validate `version_id` belongs to `job_id`; single-user authorization is API-key only. [VERIFIED: `03-CONTEXT.md`] |
| V5 Input Validation | yes | Parameterized SQL for `:id` and `:version_id`; no user-controlled filesystem paths. [VERIFIED: `CLAUDE.md`, `03-CONTEXT.md`] |
| V6 Cryptography | no new crypto | Existing timing-safe API-key compare remains unchanged. [VERIFIED: `api/src/middleware/apiKey.ts`] |

### Known Threat Patterns for Hono + subprocess PDF rendering

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection through route params | Tampering | Parameterized `pool.query`. [VERIFIED: `CLAUDE.md`, existing route patterns] |
| Cross-job version enumeration | Information Disclosure | Query by `job_id` and `version_id`; return uniform 404. [VERIFIED: `03-CONTEXT.md`] |
| Path traversal into cache/temp files | Tampering | Use UUID `version_id` filename from DB lookup, fixed cache dir, and no client-provided paths. [VERIFIED: `03-CONTEXT.md`] |
| Subprocess stderr leaks sensitive resume data | Information Disclosure | Truncate stderr in logs; never echo raw stderr to client. [VERIFIED: `03-CONTEXT.md`] |
| Render resource exhaustion | Denial of Service | Timeout plus process-wide concurrency cap. [VERIFIED: `03-CONTEXT.md`] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-resume-retrieval-and-pdf/03-CONTEXT.md` - locked decisions, route scope, tests, cache and render semantics.
- `.planning/REQUIREMENTS.md` - RESUME-01 through RESUME-05.
- `.planning/STATE.md` - current milestone and Phase 2 completion state.
- `CLAUDE.md` - project constraints, database and TDD requirements.
- `api/src/index.ts`, `api/src/routes/jobs.ts`, `api/src/routes/jobs.test.ts`, `api/src/errors.ts`, `api/src/db.ts` - current API patterns.
- `database/schema.sql` - `resume_versions` schema and immutability-relevant fields.
- `rendercv --version`, `rendercv render --help`, local Markdown smoke test - RenderCV v2.8 behavior.
- npm registry via `npm view` - package version checks.

### Secondary (MEDIUM confidence)
- RenderCV CLI docs: https://docs.rendercv.com/user_guide/cli_reference/ - CLI command descriptions and YAML input.
- RenderCV API docs: https://docs.rendercv.com/api_reference/cli/render_command/render_command/ - render command signature/options.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - current package files, npm registry, and local CLIs were checked.
- Architecture: HIGH - phase decisions and current Hono route patterns are explicit.
- Render feasibility: MEDIUM - RenderCV input mismatch is verified, but live DB source format still needs confirmation.
- Pitfalls: MEDIUM - key issues are verified, race/test pollution guidance includes assumptions.

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 for API stack; 2026-05-21 for RenderCV behavior because RenderCV docs/changelog are active.
