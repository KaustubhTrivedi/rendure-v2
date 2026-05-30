# Roadmap: Rendure — v3.0 Complete Backend

## Milestones

- [x] **v1.0** — Phases 1-5 (superseded 2026-04-13 — codebase stripped, see `.planning/phases/_archive-v1.0/`)
- [x] **v2.0 Rendure Platform Rebuild** — superseded 2026-05-13 — architecture reconsidered, see `.planning/phases/_archive-v2.0/`
- [x] **v3.0 Complete Backend** — Phases 1-4 (complete)
- [ ] **v4.0 Config-driven Multi-target Deployment** — Phases 5-10 (in progress)

---

## v3.0 Complete Backend

The existing Hono/TypeScript backend (`api/`) already handles job submission, listing, detail, status polling, and basic profile management. This milestone completes the backend so it is the single access point for both a web frontend and a Telegram bot: it adds API key protection, full profile updates, SSE pipeline progress, resume retrieval (Markdown + PDF), and Telegram bot integration. Four sequential phases — each delivers a self-contained slice of backend functionality.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (e.g., 2.1): Urgent insertions via `/gsd-insert-phase`

- [x] **Phase 1: Auth & Profile Completion** — API key middleware, PATCH /profile, error/logging conventions
- [x] **Phase 2: SSE Pipeline Progress** — Real-time GET /jobs/:id/events with replay, keepalive, terminal-state close
- [x] **Phase 3: Resume Retrieval & PDF** — Markdown endpoints, RenderCV PDF rendering with disk cache
- [x] **Phase 4: Telegram Bot Integration** — Webhook receiver, signed-update verification, terminal-state notifications

## Phase Details

### Phase 1: Auth & Profile Completion
**Goal**: Every authenticated route is protected by a single API key, the profile route exposes full update capability, and all routes share consistent error/logging conventions — a solid foundation for the remaining backend work.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, PROFILE-01, PROFILE-02, PROFILE-03, PROFILE-04, OPS-01, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. A request to any `/jobs` or `/profile` route without a valid `X-API-Key` header returns 401 with an RFC7807-style problem JSON
  2. A request with the correct `X-API-Key` passes through; `GET /` always works without a key
  3. `PATCH /profile` updates any combination of identity, pipeline default, and notification fields, validates input, and rejects unknown seniority/negative iterations with field-level errors
  4. Every request produces a structured log line including method, path, status, duration, and (when relevant) job_id
  5. Missing `RENDURE_API_KEY` env var fails server startup with a clear, actionable error
**Plans**: 4 plans
Plans:
- [x] 01-01-PLAN.md — Deps (zod, pino, pino-pretty) + DB migration + httpError helper + JSON healthcheck
- [x] 01-02-PLAN.md — pino logger middleware mounted globally
- [x] 01-03-PLAN.md — API key middleware (timing-safe) + startup gate
- [x] 01-04-PLAN.md — PATCH /profile with Zod + httpError migration of existing routes
**UI hint**: no

### Phase 2: SSE Pipeline Progress
**Goal**: A client can connect to `GET /jobs/:id/events`, immediately receive all pipeline events that have already occurred for that job, and continue receiving new events live until the job reaches a terminal status — providing the real-time channel the frontend and bot both need.
**Depends on**: Phase 1 (uses API key middleware)
**Requirements**: SSE-01, SSE-02, SSE-03, SSE-04, SSE-05
**Success Criteria** (what must be TRUE):
  1. Connecting to `GET /jobs/:id/events` mid-pipeline immediately replays all prior `pipeline_events` rows for the job, then streams new events as they are written
  2. The stream emits a keepalive comment at a fixed interval so HTTP proxies do not close the connection
  3. When the job transitions to `approved`, `low_match`, or `error`, the server emits a final event and closes the connection cleanly
  4. Requesting events for a non-existent job returns 404; requesting without `X-API-Key` returns 401
  5. Disconnect/reconnect by the client does not duplicate events the client has already seen (replay logic is idempotent on client side via event IDs)
**Plans**: 3 plans
Plans:
- [ ] 02-01-PLAN.md — Durable SSE replay route, payload helpers, auth/404/cursor behavior
- [ ] 02-02-PLAN.md — PostgreSQL pipeline_events notify trigger and listener helper
- [ ] 02-03-PLAN.md — Live LISTEN/NOTIFY streaming, keepalive, terminal close, full verification
**UI hint**: no

### Phase 3: Resume Retrieval & PDF
**Goal**: A client can list the resume versions for any job, fetch the tailored Markdown of any version, and download a PDF rendered by RenderCV — with PDF rendering cached on disk so repeat downloads are instant.
**Depends on**: Phase 1
**Requirements**: RESUME-01, RESUME-02, RESUME-03, RESUME-04, RESUME-05
**Success Criteria** (what must be TRUE):
  1. `GET /jobs/:id/resumes` returns the full list of `resume_versions` rows for the job (version_id, version_number, created_at, tailoring_notes)
  2. `GET /jobs/:id/resume/:version_id` returns the tailored Markdown for the given version with `Content-Type: text/markdown`
  3. `GET /jobs/:id/resume/:version_id/pdf` returns a rendered PDF (RenderCV via host CLI) with `Content-Type: application/pdf`
  4. Repeated PDF requests for the same `version_id` are served from disk cache without re-running RenderCV
  5. Unknown job or version IDs return 404 with a problem JSON
**Plans**: 3 plans
Plans:
- [x] 03-01-PLAN.md — Resume version list and Markdown retrieval routes with auth inheritance and uniform 404s
- [x] 03-02-PLAN.md — RenderCV host-CLI render/cache helper with contract validation, timeout, concurrency cap, and dedupe
- [x] 03-03-PLAN.md — PDF endpoint integration, startup RenderCV probe, cache ignore, and host-CLI docs
**UI hint**: no

### Phase 4: Telegram Bot Integration
**Goal**: The backend can receive job submissions from a Telegram bot (via webhook) and send pipeline result notifications back to the user's Telegram chat when a job reaches a terminal state — completing the second client surface.
**Depends on**: Phase 1, Phase 3 (needs resume endpoints for the result links)
**Requirements**: TELEGRAM-01, TELEGRAM-02, TELEGRAM-03, TELEGRAM-04, TELEGRAM-05
**Success Criteria** (what must be TRUE):
  1. `POST /telegram/webhook` accepts a Telegram update containing a URL, validates the `secret_token` header, and creates a new job
  2. Telegram updates missing or carrying an invalid `secret_token` are rejected with 401 (no job created)
  3. When any job reaches `approved`, `low_match`, or `error`, the backend sends a Telegram message to `user_profile.notify_telegram_chat_id` with status, QA score, and a way to retrieve the resume
  4. Setting `notify_telegram_chat_id = null` via `PATCH /profile` stops notifications from being sent
  5. Server starts and serves all non-Telegram routes normally when `TELEGRAM_BOT_TOKEN` is unset; Telegram routes return a clear "not configured" error
**Plans**: 4 plans
Plans:
- [x] 04-01-PLAN.md — Shared job submission helper for `/jobs` and Telegram URL intake
- [x] 04-02-PLAN.md — Telegram message formatting, Markdown escaping, and Bot API send client
- [x] 04-03-PLAN.md — `/telegram/webhook` secret-authenticated URL submission route
- [x] 04-04-PLAN.md — Terminal pipeline event Telegram notifications and startup wiring
**UI hint**: no

---

## Traceability

| REQ-ID | Phase |
|--------|-------|
| AUTH-01, AUTH-02, AUTH-03 | Phase 1 |
| PROFILE-01, PROFILE-02, PROFILE-03, PROFILE-04 | Phase 1 |
| OPS-01, OPS-02, OPS-03 | Phase 1 |
| SSE-01, SSE-02, SSE-03, SSE-04, SSE-05 | Phase 2 |
| RESUME-01, RESUME-02, RESUME-03, RESUME-04, RESUME-05 | Phase 3 |
| TELEGRAM-01, TELEGRAM-02, TELEGRAM-03, TELEGRAM-04, TELEGRAM-05 | Phase 4 |

**Coverage:** 22/22 requirements mapped — 100% ✓

---

## v4.0 Config-driven Multi-target Deployment

One codebase deployable to three targets — self-hosted (canonical, unchanged), cloud (managed Postgres + worker queue + centralized keys), and browser (PGlite/IndexedDB + client orchestration + BYOK) — behind a single `DEPLOY_TARGET` switch. Target differences are isolated to three thin adapter seams (DB, agent execution, secrets/keys). Agents, schema, and business logic stay shared. The self-hosted target stays green at every phase; cloud and browser are added on top.

## Phases (v4.0)

- [ ] **Phase 5: DEPLOY_TARGET Foundation** — Config module (TS + Python), env templates, zero-regression self-hosted default
- [ ] **Phase 6: Seam Adapters (Self-hosted Reference)** — DB adapter, agent-execution adapter, getLlmCredentials() resolver, all non-breaking
- [ ] **Phase 7: Stateless Agent Refactor** — Pure-function agents, DB I/O lifted to boundary, pytest-verified behavior preserved
- [ ] **Phase 8: Server-side Scraper Endpoint** — Stateless Jina scraper route, injection defence, structured errors
- [ ] **Phase 9: Cloud Target** — Managed Postgres, worker-queue execution adapter, centralized key resolver
- [ ] **Phase 10a: Browser Target — DB & Assets** — PGlite/IndexedDB adapter, schema bootstrap, Vite asset config, persistence opt-in
- [ ] **Phase 10b: Browser Target — Orchestration & BYOK** — Client orchestration loop, BYOK key flow, frontend data-layer swap

## Phase Details (v4.0)

### Phase 5: DEPLOY_TARGET Foundation
**Goal**: A single `DEPLOY_TARGET` config module (TypeScript + Python) exists, `.env` templates are committed for all three targets, and with no `DEPLOY_TARGET` set the runtime behaves identically to the existing self-hosted version with no regressions.
**Depends on**: Phase 4 (v3.0 complete)
**Requirements**: CONFIG-01, CONFIG-02, CONFIG-03
**Success Criteria** (what must be TRUE):
  1. `import { config } from './config'` (TS) and `from config import config` (Python) expose a resolved settings object whose values match `DEPLOY_TARGET` — defaulting to `self-hosted`
  2. `.env.self-hosted`, `.env.cloud`, and `.env.browser` template files are committed to the repo; no real secrets are present in any committed file
  3. Starting the API and running the Python pipeline with no `DEPLOY_TARGET` env var (or `DEPLOY_TARGET=self-hosted`) produces zero behavioral change — all existing vitest and pytest suites pass green
**Plans**: 3 plans
Plans:
- [ ] 05-01-PLAN.md — TS config module (frozen singleton, fail-fast validation) + shared parity fixture
- [ ] 05-02-PLAN.md — Python config module (frozen dataclass singleton) + cross-language parity tests
- [ ] 05-03-PLAN.md — Per-target .env templates (placeholders only) + gitignore + README

### Phase 6: Seam Adapters (Self-hosted Reference Implementation)
**Goal**: Three named adapter seams exist in the codebase — DB, agent-execution, and secrets/keys — each with a self-hosted implementation that is functionally identical to the code it replaces, so no behavior changes while the insertion points are established.
**Depends on**: Phase 5
**Requirements**: SEAM-01, SEAM-02, SEAM-03, SEAM-04
**Success Criteria** (what must be TRUE):
  1. A `createDb()` adapter function returns today's `pg` pool when `DEPLOY_TARGET=self-hosted`; all DB-touching routes work identically after the refactor
  2. The single pipeline-spawn site in `api/src/job-submission.ts` is wrapped by an agent-execution adapter; self-hosted impl still runs `uv run python run_agents.py` as a detached subprocess
  3. `getLlmCredentials()` is the sole source of LLM keys in the agent layer; self-hosted impl reads from local env / `tokens.json` exactly as before
  4. Full vitest and pytest suites pass green after all three seams land — no observable self-hosted behavior change
**Plans**: TBD

### Phase 7: Stateless Agent Refactor
**Goal**: Each Python agent is a pure function — all inputs arrive as arguments, all outputs are returned values, and no agent module opens a database connection directly — making agents runnable under subprocess, queue worker, or browser loop without modification.
**Depends on**: Phase 6
**Requirements**: AGENT-01, AGENT-02, AGENT-03
**Success Criteria** (what must be TRUE):
  1. Each agent (`job_scout`, `resume_tailor`, `quality_analyst`, `confirmation`) is callable as a pure function with no side-effects beyond returning its output; the orchestrator/boundary supplies all DB interactions
  2. No agent module contains an `import psycopg2` statement or opens a database connection directly
  3. Existing pytest suite (behavior tests: QA scoring formula, tailoring rules, injection defence) passes green with refactored agents; the self-hosted orchestrator drives them end-to-end without regression
**Plans**: TBD

### Phase 8: Server-side Scraper Endpoint
**Goal**: A stateless server endpoint handles Jina scraping so the browser target is never blocked by CORS, scraper behavior is shared by all targets, and malformed or adversarial inputs are rejected with structured error responses.
**Depends on**: Phase 6
**Requirements**: SCRAPE-01, SCRAPE-02
**Success Criteria** (what must be TRUE):
  1. `POST /scrape` (or equivalent) accepts a job URL, fetches the page via Jina Reader server-side, and returns cleaned JD Markdown — usable by self-hosted, cloud, and browser targets alike
  2. The endpoint applies injection defence: content containing embedded instructions is returned as plain text without being followed; a pipeline_events log entry is written when suspicious content is detected
  3. Invalid URL, Jina fetch failure, and empty-content responses each return a distinct structured error (with a meaningful HTTP status code and problem JSON), verified by vitest tests
**Plans**: TBD

### Phase 9: Cloud Target
**Goal**: Setting `DEPLOY_TARGET=cloud` switches the three seams to their cloud implementations — managed Postgres connection, worker-queue pipeline enqueue, and centralized key resolver — without touching self-hosted or browser paths.
**Depends on**: Phase 6, Phase 7, Phase 8
**Requirements**: CLOUD-01, CLOUD-02, CLOUD-03
**Success Criteria** (what must be TRUE):
  1. Under `DEPLOY_TARGET=cloud`, the DB adapter resolves and uses a managed Postgres connection string; the self-hosted adapter path is untouched and still passes its tests when mocked with `DEPLOY_TARGET=self-hosted`
  2. Under `DEPLOY_TARGET=cloud`, submitting a job enqueues to the configured worker queue instead of spawning a local subprocess; the queue message contains all context needed for the worker to run the stateless agents
  3. Under `DEPLOY_TARGET=cloud`, `getLlmCredentials()` retrieves centralized LLM keys from a secret store; no per-user billing or quota logic is implemented (explicitly deferred)
**Plans**: TBD

### Phase 10a: Browser Target — DB and Assets
**Goal**: Under `DEPLOY_TARGET=browser`, the DB adapter provides a PGlite/IndexedDB client with the full schema bootstrapped exactly once (surviving reload), and Vite is configured so the PGlite WASM bundle loads correctly and the user can opt into durable persistence.
**Depends on**: Phase 6, Phase 7, Phase 8
**Requirements**: BROWSER-01, BROWSER-02
**Success Criteria** (what must be TRUE):
  1. Under `DEPLOY_TARGET=browser`, `createDb()` returns a PGlite client backed by `idb://`; on first load, `database/schema.sql` (with all 4 triggers, JSONB, allowed_transitions) bootstraps unmodified; a page reload does not re-run bootstrap and does not lose data
  2. The Vite config includes `optimizeDeps.exclude: ['@electric-sql/pglite']` and correct static `.wasm`/`.data` asset serving; the PGlite FS bundle loads uncorrupted in a fresh browser tab
  3. `navigator.storage.persist()` is called on a real user gesture (not at module load time); the browser grants or denies it and the outcome is surfaced to the user
**Plans**: TBD
**UI hint**: yes

### Phase 10b: Browser Target — Orchestration and BYOK
**Goal**: A client-side orchestration loop drives the stateless agent endpoints in the correct sequence (with QA retry), the user's OpenRouter key is stored encrypted in local PGlite and used per-call without touching the server, and the frontend reads and writes entirely from local PGlite with a clear data-locality disclosure.
**Depends on**: Phase 10a
**Requirements**: BROWSER-03, BROWSER-04, BROWSER-05
**Success Criteria** (what must be TRUE):
  1. In the browser target, submitting a job URL triggers a client-side loop that calls scout → tailor → QA → confirm endpoints in sequence, drives the QA→tailor retry up to `max_iterations`, and uses PGlite LISTEN/NOTIFY to propagate status transitions validated against `allowed_transitions`
  2. The user can enter an OpenRouter API key that is stored AES-encrypted in local PGlite; it is sent per-call in the request header and is never stored or logged server-side
  3. All frontend reads (job list, job detail, pipeline events, resume versions, profile) and writes (submit job, update profile) target local PGlite; a persistent UI disclosure states that data is browser-local, per-device, and lost on clear-site-data
**Plans**: TBD
**UI hint**: yes

---

## Traceability (v4.0)

| REQ-ID | Phase |
|--------|-------|
| CONFIG-01, CONFIG-02, CONFIG-03 | Phase 5 |
| SEAM-01, SEAM-02, SEAM-03, SEAM-04 | Phase 6 |
| AGENT-01, AGENT-02, AGENT-03 | Phase 7 |
| SCRAPE-01, SCRAPE-02 | Phase 8 |
| CLOUD-01, CLOUD-02, CLOUD-03 | Phase 9 |
| BROWSER-01, BROWSER-02 | Phase 10a |
| BROWSER-03, BROWSER-04, BROWSER-05 | Phase 10b |

**Coverage:** 20/20 v4.0 requirements mapped — 100% ✓

## Progress Table (v4.0)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. DEPLOY_TARGET Foundation | 0/? | Not started | - |
| 6. Seam Adapters (Self-hosted Ref) | 0/? | Not started | - |
| 7. Stateless Agent Refactor | 0/? | Not started | - |
| 8. Server-side Scraper Endpoint | 0/? | Not started | - |
| 9. Cloud Target | 0/? | Not started | - |
| 10a. Browser Target — DB & Assets | 0/? | Not started | - |
| 10b. Browser Target — Orchestration & BYOK | 0/? | Not started | - |
