# Requirements — Milestone v3.0 (Complete Backend)

Scope: complete the Hono/TypeScript backend (`api/`) so it is the single access point for both a web frontend and a Telegram bot. Single-user, self-hosted, protected by an API key in `.env`. Pipeline agents and Postgres schema are unchanged.

Previous milestone (v2.0) is superseded — see `.planning/MILESTONES.md`.

---

## v3.0 Requirements

### AUTH — API key protection

- [ ] **AUTH-01**: All `/jobs` and `/profile` routes reject requests missing or carrying an invalid `X-API-Key` header with HTTP 401
- [ ] **AUTH-02**: The expected API key is read from `RENDURE_API_KEY` in `.env` at startup; missing env var fails startup with a clear error
- [ ] **AUTH-03**: A health check route (`GET /`) remains unauthenticated for liveness checks

### PROFILE — Profile management completion

- [ ] **PROFILE-01**: User can update profile fields (`display_name`, `target_seniority`, `highlight_skills`, `preferred_industries`, `tailor_style_notes`) via `PATCH /profile`
- [ ] **PROFILE-02**: User can update pipeline defaults (`qa_threshold`, `max_iterations`, `preferred_model`) via `PATCH /profile`
- [ ] **PROFILE-03**: User can update notification endpoints (`notify_telegram_chat_id`, `notify_webhook_url`) via `PATCH /profile`
- [ ] **PROFILE-04**: `PATCH /profile` returns 400 with field-level errors for invalid input (unknown seniority, malformed JSON, negative iterations)

### SSE — Real-time pipeline progress

- [x] **SSE-01**: `GET /jobs/:id/events` streams pipeline events as Server-Sent Events for the given job
- [x] **SSE-02**: On connection, the stream replays existing `pipeline_events` rows for the job before subscribing to new ones (so a reconnecting client doesn't lose events)
- [x] **SSE-03**: The stream closes cleanly when the job reaches a terminal status (`approved`, `low_match`, `error`)
- [x] **SSE-04**: The stream sends periodic keepalive comments so proxies do not idle-close the connection
- [x] **SSE-05**: `GET /jobs/:id/events` returns 404 if the job does not exist, 401 if `X-API-Key` is missing

### RESUME — Tailored resume retrieval

- [ ] **RESUME-01**: `GET /jobs/:id/resume/:version_id` returns the tailored resume Markdown for an approved version
- [ ] **RESUME-02**: `GET /jobs/:id/resume/:version_id/pdf` returns a rendered PDF (via RenderCV in Docker) with `Content-Type: application/pdf`
- [ ] **RESUME-03**: PDF rendering results are cached on disk and re-served from cache for subsequent requests of the same `version_id`
- [ ] **RESUME-04**: `GET /jobs/:id/resumes` lists all resume versions for a job (version_id, version_number, created_at, tailoring_notes)
- [ ] **RESUME-05**: Resume endpoints return 404 for unknown job or version IDs

### TELEGRAM — Telegram bot integration

- [x] **TELEGRAM-01**: `POST /telegram/webhook` accepts Telegram bot updates (text messages with URLs) and submits them to the pipeline as a new job
- [ ] **TELEGRAM-02**: Webhook signature/secret verification rejects unauthenticated Telegram updates (using Telegram's `secret_token`)
- [ ] **TELEGRAM-03**: When a job reaches a terminal status, the backend sends a Telegram message to the configured chat with status, QA score, and a link/handle to retrieve the resume
- [ ] **TELEGRAM-04**: The Telegram chat ID for notifications is stored on `user_profile.notify_telegram_chat_id` (set via `PATCH /profile`)
- [ ] **TELEGRAM-05**: Telegram bot token is read from `TELEGRAM_BOT_TOKEN` in `.env`; missing token disables Telegram features (does not crash the server)

### OPS — Operational concerns for self-hosting

- [ ] **OPS-01**: All routes return RFC7807-style problem JSON for errors (`{ error, detail?, code? }`) consistently
- [ ] **OPS-02**: Structured request logs include method, path, status, duration, and job_id (when relevant)
- [ ] **OPS-03**: `GET /` returns a JSON liveness payload (`{ ok: true, version }`) suitable for Docker healthcheck

---

## Future Requirements (later milestones)

- Web frontend (React/Vite client consuming this API)
- Telegram bot polished UX (rich messages, inline keyboards, multi-step conversations)
- Docker compose orchestration (api + db + rendercv worker)
- Production deploy via Dokploy + Traefik

## Out of Scope (v3.0)

- Multi-user support — single-user only
- OAuth or any per-user auth — single API key suffices
- Resume editing endpoints — pipeline output is authoritative
- Email notifications — Telegram is the notification channel
- Rate limiting per user — not needed in single-user mode
- WebSocket support — SSE covers progress, polling covers everything else

---

## Traceability

| REQ-ID | Phase |
|--------|-------|
| AUTH-01, AUTH-02, AUTH-03 | Phase 1 — Auth & Profile Completion |
| PROFILE-01, PROFILE-02, PROFILE-03, PROFILE-04 | Phase 1 — Auth & Profile Completion |
| OPS-01, OPS-02, OPS-03 | Phase 1 — Auth & Profile Completion |
| SSE-01..05 | Phase 2 — SSE Pipeline Progress |
| RESUME-01..05 | Phase 3 — Resume Retrieval & PDF |
| TELEGRAM-01..05 | Phase 4 — Telegram Bot Integration |

**Coverage:** 22/22 requirements mapped — 100% ✓
