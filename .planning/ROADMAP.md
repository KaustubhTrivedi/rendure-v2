# Roadmap: Rendure — v3.0 Complete Backend

## Milestones

- [x] **v1.0** — Phases 1-5 (superseded 2026-04-13 — codebase stripped, see `.planning/phases/_archive-v1.0/`)
- [x] **v2.0 Rendure Platform Rebuild** — superseded 2026-05-13 — architecture reconsidered, see `.planning/phases/_archive-v2.0/`
- [ ] **v3.0 Complete Backend** — Phases 1-4 (in progress)

---

## v3.0 Complete Backend

The existing Hono/TypeScript backend (`api/`) already handles job submission, listing, detail, status polling, and basic profile management. This milestone completes the backend so it is the single access point for both a web frontend and a Telegram bot: it adds API key protection, full profile updates, SSE pipeline progress, resume retrieval (Markdown + PDF), and Telegram bot integration. Four sequential phases — each delivers a self-contained slice of backend functionality.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (e.g., 2.1): Urgent insertions via `/gsd-insert-phase`

- [x] **Phase 1: Auth & Profile Completion** — API key middleware, PATCH /profile, error/logging conventions
- [x] **Phase 2: SSE Pipeline Progress** — Real-time GET /jobs/:id/events with replay, keepalive, terminal-state close
- [ ] **Phase 3: Resume Retrieval & PDF** — Markdown endpoints, RenderCV PDF rendering with disk cache
- [ ] **Phase 4: Telegram Bot Integration** — Webhook receiver, signed-update verification, terminal-state notifications

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
- [ ] 03-01-PLAN.md — Resume version list and Markdown retrieval routes with auth inheritance and uniform 404s
- [ ] 03-02-PLAN.md — RenderCV host-CLI render/cache helper with contract validation, timeout, concurrency cap, and dedupe
- [ ] 03-03-PLAN.md — PDF endpoint integration, startup RenderCV probe, cache ignore, and host-CLI docs
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
**Plans**: To be defined in `/gsd-plan-phase 4`
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
