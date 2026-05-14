# Phase 2: SSE Pipeline Progress - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 adds the backend real-time progress stream for a single job: `GET /jobs/:id/events`.

On connection, the endpoint verifies the job exists, replays all prior `pipeline_events` rows for that job, then streams new rows live until the job reaches a terminal status (`approved`, `low_match`, or `error`). The route is part of the authenticated `/jobs` API surface from Phase 1 and must use the existing API key middleware, RFC7807 hybrid error helper, pino logging, and Vitest test patterns.

This phase does not build frontend progress UI, Telegram notifications, resume retrieval, or PDF rendering.

</domain>

<decisions>
## Implementation Decisions

### Live Delivery Strategy
- **D-01:** Use PostgreSQL `LISTEN/NOTIFY` for live delivery of new `pipeline_events` rows after the initial replay.
- **D-02:** Because Python agents write `pipeline_events` directly, the notification source must be database-level or otherwise guaranteed for every writer, not only API code paths. A Postgres trigger/function on `pipeline_events` is the expected implementation direction for research/planning.
- **D-03:** The stream still treats the database table as source of truth. `LISTEN/NOTIFY` is only the wake-up mechanism; replay and any missed-event recovery are done by querying `pipeline_events`.

### SSE Payload Shape
- **D-04:** Emit the full pipeline event row to clients: `event_id`, `job_id`, `event_type`, `agent_name`, `from_status`, `to_status`, `model_used`, `detail`, `metadata`, and `timestamp`.
- **D-05:** Preserve the database column name `timestamp` in the payload unless the implementation adds a documented compatibility alias. The current schema uses `timestamp`, not `created_at`, for `pipeline_events`.
- **D-06:** Use a stable SSE event type for pipeline rows, such as `event: pipeline_event`. Do not create many different wire shapes by `event_type`; clients can branch on the payload's `event_type` field.

### Replay Cursor
- **D-07:** Use the SSE `id:` field as `pipeline_events.event_id`.
- **D-08:** Honor the standard `Last-Event-ID` request header on reconnect. When present, replay only events for the job after that event in stream order. When absent, replay all events for the job.
- **D-09:** Replay ordering must be deterministic. Query by `timestamp ASC, event_id ASC`; if `Last-Event-ID` is supplied, find that event for the same job and replay rows after its `(timestamp, event_id)` cursor.
- **D-10:** If `Last-Event-ID` is unknown for this job, fall back to a full replay rather than returning an error. That is safer for reconnecting clients and preserves idempotent client-side dedupe by event ID.

### Keepalive And Terminal Close
- **D-11:** Send an SSE keepalive comment every 30 seconds, e.g. `: keepalive\n\n`, while the stream is open.
- **D-12:** After emitting a row whose `to_status` is terminal (`approved`, `low_match`, `error`), close the response cleanly.
- **D-13:** If the job is already terminal at connection time, replay existing events including the terminal row, then close immediately after replay.

### Route And Error Semantics
- **D-14:** `GET /jobs/:id/events` lives in `api/src/routes/jobs.ts` unless planning finds a strong reason to split a dedicated helper module. It remains mounted under `/jobs` and therefore inherits Phase 1 `X-API-Key` protection from `api/src/index.ts`.
- **D-15:** A missing job returns `404` using `httpError(c, 404, 'not_found', 'Job not found.')`; unauthenticated requests continue to return Phase 1's `401` from middleware.
- **D-16:** Stream setup failures after headers are not yet sent should use RFC7807 errors. Failures after the stream has started should emit a final SSE error-style event when possible, then close.

### Testing
- **D-17:** Follow TDD with Vitest. Tests should cover auth inheritance through the mounted app, missing job `404`, replay order, `Last-Event-ID` replay, keepalive comment emission, live event delivery after notification, and terminal close behavior.
- **D-18:** Mock Postgres at the outer boundary (`pool.query` / pg client notification behavior). Do not mock internal route helpers once they exist.

### the agent's Discretion
- Exact helper/module split for formatting SSE frames and managing the Postgres listener.
- Whether to introduce a small dedicated Postgres listener abstraction under `api/src/` if that keeps `jobs.ts` readable.
- Exact SSE frame formatting helper names.
- Whether to include a final synthetic `stream_end` event in addition to the terminal pipeline row, provided the terminal pipeline row is always emitted first and the stream closes cleanly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope And Requirements
- `.planning/ROADMAP.md` — Phase 2 goal, dependency on Phase 1, and success criteria.
- `.planning/REQUIREMENTS.md` — `SSE-01` through `SSE-05`.
- `.planning/PROJECT.md` — backend-first, single API access point, pipeline agents and database schema constraints.
- `.planning/STATE.md` — Phase 1 completion state and pending migration note.

### Prior Phase Context
- `.planning/phases/01-auth-profile-completion/01-CONTEXT.md` — locked API key middleware, RFC7807 hybrid error shape, pino logging, Hono route mount decisions, and TDD expectations.

### Code And Schema
- `api/src/index.ts` — Hono app mount; `/jobs/*` API key middleware is already applied here.
- `api/src/routes/jobs.ts` — existing jobs routes; likely home for `GET /jobs/:id/events`.
- `api/src/routes/jobs.test.ts` — existing jobs route Vitest patterns and DB mock setup.
- `api/src/errors.ts` — shared `httpError()` helper for RFC7807 hybrid errors.
- `api/src/db.ts` — exported `pg.Pool`; likely integration point for queries/listening.
- `database/schema.sql` — `jobs`, `pipeline_events`, status state machine, and terminal statuses.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/src/db.ts` exports the shared `pool`; reuse it for job existence checks, replay queries, and listener setup unless research finds a cleaner pg pattern.
- `api/src/errors.ts` provides the required hybrid problem JSON helper.
- `api/src/routes/jobs.test.ts` already mocks `pool.query` and exercises route handlers directly.
- `api/src/index.ts` already mounts API key middleware for `/jobs/*`; endpoint-level auth code should not be duplicated.

### Established Patterns
- Hono route modules are mounted as grouped routers from `api/src/index.ts`.
- Route tests are co-located with source and use Vitest.
- Errors use JSON `application/json`, not strict `application/problem+json`.
- Request bodies and secrets are not logged; the SSE route should not log payload metadata that may contain sensitive data beyond normal request logging.

### Integration Points
- `pipeline_events` rows are written by Python agents and by API error paths. Live delivery must observe DB writes from all writers.
- Terminal status is represented by `pipeline_events.to_status` and `jobs.status`; terminal statuses are `approved`, `low_match`, and `error`.
- Existing `GET /jobs/:id` currently fetches recent `pipeline_events` ordered by `timestamp DESC`; the SSE route needs ascending stream order.

</code_context>

<specifics>
## Specific Ideas

- The endpoint should be useful to both future web frontend and Telegram bot consumers, so the wire payload should stay complete and audit-oriented rather than UI-specific.
- `LISTEN/NOTIFY` is selected for efficiency, but the table remains canonical so reconnects and missed notifications are recoverable.

</specifics>

<deferred>
## Deferred Ideas

- Frontend stage indicator, reconnect banner, and dashboard live UX are out of scope for this backend phase.
- Telegram terminal-state notifications are Phase 4.
- Resume links or PDF download events are Phase 3/4 concerns, not part of the SSE endpoint contract.

</deferred>

---

*Phase: 02-sse-pipeline-progress*
*Context gathered: 2026-05-13*
