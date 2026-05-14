# Phase 2, Plan 01 Summary: SSE Replay Route

**Date:** 2026-05-13
**Status:** Complete ✓

## Deliverables

### New file: `api/src/sse.ts`
- `PIPELINE_SSE_EVENT = 'pipeline_event'` — stable SSE event type
- `TERMINAL_STATUSES` — `Set` with `approved`, `low_match`, `error`
- `isTerminalStatus()` — null-safe check against `TERMINAL_STATUSES`
- `PipelineEventRow` / `PipelineEventPayload` interfaces
- `toPipelineEventPayload()` — maps DB row to payload shape (preserves `timestamp`, omits `payload` and `created_at`)

### Modified file: `api/src/routes/jobs.ts`
- Added `GET /jobs/:id/events` before `/:id/status` to avoid path capture
- Authentication inherited from existing `app.use('/jobs/*', apiKeyMiddleware())` mount
- Preflight `SELECT job_id, status FROM jobs WHERE job_id = $1` — missing job returns `404` via `httpError`
- `Last-Event-ID` cursor replay: validates cursor exists for this job, uses `(timestamp, event_id) > ($2, $3)` for deterministic ordering after cursor
- Unknown `Last-Event-ID` falls back to full replay (D-10)
- Replay query: `SELECT ... FROM pipeline_events WHERE job_id = $1 ORDER BY timestamp ASC, event_id ASC`
- Terminal row closes stream immediately after emitting (D-12, D-13)
- Uses `streamSSE` from `hono/streaming` with `writeSSE({ id, event, data })`

### Tests: `api/src/routes/jobs.test.ts`
7 new tests (55 total across suite, all green):

| Test | What it proves |
|------|---------------|
| `toPipelineEventPayload` serialization | Stable payload shape, no `created_at` or `payload` |
| 401 without X-API-Key | Auth via mounted app works |
| 404 for missing job | Preflight check before stream |
| Replay order ASC | `timestamp ASC, event_id ASC` |
| Last-Event-ID cursor | Only rows after cursor emitted |
| Unknown Last-Event-ID fallback | Unknown cursor → full replay |
| Terminal close | Stream closes after terminal `to_status` |

## Verification
- `cd api && npm run test` — 55/55 passed (6 files)
- `cd api && npm run build` — tsc compiles cleanly

## Tests per Plan Specification
- ✅ Auth inheritance through mounted app
- ✅ Missing job 404
- ✅ Replay order (timestamp ASC, event_id ASC)
- ✅ Last-Event-ID cursor replay
- ✅ Unknown Last-Event-ID fallback to full replay
- ✅ Terminal replay close
