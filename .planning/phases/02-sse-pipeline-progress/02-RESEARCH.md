# Phase 02: SSE Pipeline Progress - Research

**Researched:** 2026-05-13 [VERIFIED: system date]
**Domain:** Hono Server-Sent Events over PostgreSQL `LISTEN/NOTIFY` for pipeline progress [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: official Hono, PostgreSQL, node-postgres, MDN, Vitest docs plus local code inspection]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Claude's Discretion
- Exact helper/module split for formatting SSE frames and managing the Postgres listener.
- Whether to introduce a small dedicated Postgres listener abstraction under `api/src/` if that keeps `jobs.ts` readable.
- Exact SSE frame formatting helper names.
- Whether to include a final synthetic `stream_end` event in addition to the terminal pipeline row, provided the terminal pipeline row is always emitted first and the stream closes cleanly.

### Deferred Ideas (OUT OF SCOPE)

- Frontend stage indicator, reconnect banner, and dashboard live UX are out of scope for this backend phase.
- Telegram terminal-state notifications are Phase 4.
- Resume links or PDF download events are Phase 3/4 concerns, not part of the SSE endpoint contract.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SSE-01 | `GET /jobs/:id/events` streams pipeline events as Server-Sent Events for the given job. | Use Hono `streamSSE()` and stable `event: pipeline_event` frames. [CITED: https://hono.dev/docs/helpers/streaming] |
| SSE-02 | On connection, the stream replays existing `pipeline_events` rows before subscribing to new ones. | Query `pipeline_events` as source of truth in `timestamp ASC, event_id ASC` order before relying on notifications. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md] |
| SSE-03 | The stream closes cleanly when the job reaches `approved`, `low_match`, or `error`. | Terminal detection should be based on replayed or live row `to_status`. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md] |
| SSE-04 | The stream sends periodic keepalive comments. | SSE comments are valid keepalive frames and are ignored by clients. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events] |
| SSE-05 | Route returns 404 for missing job and 401 without `X-API-Key`. | Reuse `httpError()` and inherited `/jobs/*` API key middleware. [VERIFIED: api/src/index.ts; api/src/errors.ts] |
</phase_requirements>

## Summary

Phase 2 should add a Hono SSE route under the existing authenticated `/jobs` router, perform a pre-stream job existence check, replay durable `pipeline_events` rows, then keep the response open while a dedicated PostgreSQL listener wakes the route for new events. [VERIFIED: api/src/index.ts; api/src/routes/jobs.ts; database/schema.sql; CITED: https://hono.dev/docs/helpers/streaming]

The important reliability choice is to keep PostgreSQL as the source of truth and treat `NOTIFY` only as a wake-up signal; PostgreSQL documentation explicitly recommends table-backed payload lookup for larger structured data and statement triggers when notification should happen automatically for every table write. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]

**Primary recommendation:** Add a small listener/SSE helper module plus a `GET /:id/events` route in `api/src/routes/jobs.ts`; add a `pipeline_events` trigger that calls `pg_notify` with the event id/job id; on each wake-up, re-query rows after the last sent `(timestamp, event_id)` cursor. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md; CITED: https://www.postgresql.org/docs/17/sql-notify.html]

## Project Constraints (from AGENTS.md)

- Use Python 3.12 and `uv` for Python dependency management; do not use `pip install` for project deps. [VERIFIED: AGENTS.md]
- Backend work for this phase is in the Hono/TypeScript `api/` app. [VERIFIED: .planning/STATE.md; api/src/index.ts]
- All `/jobs/*` routes must remain protected by `X-API-Key` middleware mounted in `api/src/index.ts`; endpoint-level duplicate auth is unnecessary. [VERIFIED: api/src/index.ts; api/src/middleware/apiKey.ts]
- Use parameterized SQL exclusively and never string-interpolate values into SQL. [VERIFIED: AGENTS.md]
- `pipeline_events` is an audit log table and is the inter-agent state channel; Python agents write it directly. [VERIFIED: AGENTS.md; database/schema.sql]
- `pipeline_events.timestamp` is the existing event time column; do not assume `created_at` exists on that table. [VERIFIED: database/schema.sql]
- TDD is mandatory for all production changes; use vertical RED-GREEN-REFACTOR slices and do not mock internal collaborators. [VERIFIED: AGENTS.md; .agents/skills/tdd/SKILL.md]
- Do not modify `utils/Antigravity.py`; this phase should not need to touch it. [VERIFIED: AGENTS.md]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.12.18 | API routing and SSE response streaming. | Existing API framework and official `streamSSE()` helper. [VERIFIED: api/package.json; api/node_modules/hono/package.json; CITED: https://hono.dev/docs/helpers/streaming] |
| `@hono/node-server` | 1.19.14 | Node HTTP adapter for Hono. | Existing server adapter in `api/src/index.ts`. [VERIFIED: api/package.json; api/node_modules/@hono/node-server/package.json; api/src/index.ts] |
| `pg` | 8.20.0 | PostgreSQL pool/client queries and `LISTEN/NOTIFY` notification events. | Existing DB client; official API exposes `client.on('notification')`. [VERIFIED: api/package.json; api/node_modules/pg/package.json; CITED: https://node-postgres.com/apis/client] |
| PostgreSQL | project DB | Durable `jobs` and `pipeline_events` storage plus trigger-backed `pg_notify`. | Existing schema and official `NOTIFY` trigger guidance fit cross-writer event delivery. [VERIFIED: database/schema.sql; CITED: https://www.postgresql.org/docs/17/sql-notify.html] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.1.5 | Route, helper, and timer tests. | Existing test runner; fake timers support keepalive tests without 30s waits. [VERIFIED: api/package.json; api/node_modules/vitest/package.json; CITED: https://main.vitest.dev/guide/mocking/timers] |
| TypeScript | 5.9.3 installed, package range `^5.8.3` | Strict API implementation. | Existing `api/tsconfig.json` is strict NodeNext ESM. [VERIFIED: api/node_modules/typescript/package.json; api/tsconfig.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hono `streamSSE()` | Manual `ReadableStream` | Manual streams give full frame control, but Hono already has an SSE helper and stream abort hooks. [CITED: https://hono.dev/docs/helpers/streaming] |
| Native `pg.Client` listener | `pg-listen` helper library | A library can add reconnection behavior, but no new dependency is required for this single-process self-hosted backend. [VERIFIED: api/package.json; ASSUMED] |
| `NOTIFY` full row payload | `NOTIFY` event id/job id only, then query DB | PostgreSQL payloads are text and under 8000 bytes by default; table lookup is the safer standard for structured rows. [CITED: https://www.postgresql.org/docs/17/sql-notify.html] |

**Installation:**
```bash
# No new package is required for the recommended implementation.
cd api && npm install
```

**Version verification:** `npm` is not available in this execution environment, so versions were verified from `api/package.json`, `api/package-lock.json`, and installed `api/node_modules/*/package.json`; web search also found current public references for Hono 4.12.18, pg 8.20.0, and Vitest 4.1.5. [VERIFIED: local command output; VERIFIED: web search]

## Architecture Patterns

### Recommended Project Structure
```text
api/src/
├── routes/
│   ├── jobs.ts              # Add GET /:id/events route and keep small orchestration here.
│   └── jobs.test.ts         # Add behavior tests, including app-level auth inheritance.
├── db.ts                    # Keep shared query pool; optionally export a Client factory.
├── sse.ts                   # Optional small helper: frame/event formatting and terminal status.
└── pg-listener.ts           # Optional small helper: LISTEN lifecycle if jobs.ts becomes noisy.
database/
├── schema.sql               # Add idempotent trigger/function for pipeline_events notifications.
└── 003_pipeline_events_notify.sql # Recommended migration file for live DBs.
```
[VERIFIED: api/src layout; database migration pattern in database/001_user_profile.sql and database/002_telegram.sql]

### Pattern 1: Preflight Before Streaming
**What:** Check job existence with `SELECT job_id, status FROM jobs WHERE job_id = $1` before returning a streaming response. [VERIFIED: api/src/routes/jobs.ts pattern]

**When to use:** Required for `404` because once an SSE response starts, normal RFC7807 JSON cannot replace the stream body. [CITED: https://hono.dev/docs/helpers/streaming]

**Example:**
```typescript
const jobResult = await pool.query(
  `SELECT job_id, status FROM jobs WHERE job_id = $1`,
  [id],
)
if (jobResult.rows.length === 0) {
  return httpError(c, 404, 'not_found', 'Job not found.')
}
```
[VERIFIED: api/src/routes/jobs.ts; api/src/errors.ts]

### Pattern 2: Replay, Then Subscribe, Then Re-query
**What:** Replay durable rows first, then register `LISTEN`, and for each notification query rows after the last sent cursor. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

**When to use:** This prevents dropped notifications from becoming dropped client events because `pipeline_events` remains canonical. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]

**Example:**
```typescript
const rows = await pool.query(
  `SELECT event_id, job_id, event_type, agent_name, from_status, to_status,
          model_used, detail, metadata, timestamp
     FROM pipeline_events
    WHERE job_id = $1
      AND (timestamp, event_id) > ($2::timestamptz, $3::uuid)
    ORDER BY timestamp ASC, event_id ASC`,
  [jobId, cursorTimestamp, cursorEventId],
)
```
[VERIFIED: database/schema.sql; .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

### Pattern 3: Database Trigger Notification
**What:** Add an `AFTER INSERT ON pipeline_events` trigger that notifies a single channel with a compact JSON payload containing at least `job_id` and `event_id`. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]

**When to use:** Required because both Python agents and API code write `pipeline_events`, so application-only notification code would miss some writers. [VERIFIED: AGENTS.md; .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

**Example:**
```sql
CREATE OR REPLACE FUNCTION notify_pipeline_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'pipeline_events',
    json_build_object('job_id', NEW.job_id, 'event_id', NEW.event_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_pipeline_event ON pipeline_events;
CREATE TRIGGER trg_notify_pipeline_event
AFTER INSERT ON pipeline_events
FOR EACH ROW
EXECUTE FUNCTION notify_pipeline_event();
```
[CITED: https://www.postgresql.org/docs/17/sql-notify.html; VERIFIED: database/schema.sql trigger style]

### Anti-Patterns to Avoid
- **Using `NOTIFY` as the event store:** Notifications are a wake-up signal, not the authoritative stream payload. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]
- **Opening a pooled query connection as a listener and returning it to the pool:** `LISTEN` is session-scoped, so use a dedicated long-lived client for each active stream or a shared listener abstraction that fans out notifications. [CITED: https://node-postgres.com/apis/client; CITED: https://www.postgresql.org/docs/17/sql-listen.html]
- **Writing SSE errors through Hono `onError`:** Hono documents that errors thrown inside streaming callbacks do not trigger normal `onError` response replacement. [CITED: https://hono.dev/docs/helpers/streaming]
- **Ordering by timestamp alone:** Equal timestamps can produce nondeterministic order; use `timestamp ASC, event_id ASC`. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE framing | Custom ad hoc text concatenation across route code | Hono `streamSSE().writeSSE()` for normal events; one small helper only for comments if needed | Hono already handles SSE event/id/data fields. [CITED: https://hono.dev/docs/helpers/streaming] |
| Live DB event transport | Poll loop every second | PostgreSQL trigger plus `LISTEN/NOTIFY` | Locked decision and avoids unnecessary DB load. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md] |
| Durable replay cursor | In-memory event index | SQL cursor based on `(timestamp, event_id)` | Survives API restarts and reconnects. [VERIFIED: database/schema.sql] |
| Authentication | Route-specific API key logic | Existing `/jobs/*` middleware | Phase 1 already centralizes auth and constant-time comparison. [VERIFIED: api/src/index.ts; api/src/middleware/apiKey.ts] |

**Key insight:** The hard part is not serializing SSE; it is making reconnect and missed notification behavior deterministic by always returning to the database as canonical state. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Race Between Replay And Listen
**What goes wrong:** An event inserted after replay query completion but before `LISTEN` registration can be missed by live delivery. [ASSUMED]
**Why it happens:** `LISTEN/NOTIFY` only reaches sessions already listening; it is not a persisted queue. [CITED: https://www.postgresql.org/docs/17/sql-listen.html]
**How to avoid:** Prefer registering `LISTEN` before final replay, or after registering listener immediately query rows after the last sent cursor before waiting for notifications. [ASSUMED]
**Warning signs:** Tests pass for pure replay and pure live delivery but fail for an insert that happens during stream setup. [ASSUMED]

### Pitfall 2: Stream Starts Before 404 Decision
**What goes wrong:** A missing job cannot return the required JSON `404` after `text/event-stream` headers are sent. [CITED: https://hono.dev/docs/helpers/streaming]
**Why it happens:** Streaming callbacks run after response start. [CITED: https://hono.dev/docs/helpers/streaming]
**How to avoid:** Perform job existence and Last-Event-ID lookup decisions before returning `streamSSE()`. [VERIFIED: api/src/routes/jobs.ts pattern]
**Warning signs:** Tests read an SSE error frame instead of HTTP 404 for missing job. [ASSUMED]

### Pitfall 3: Notification Payload Too Large
**What goes wrong:** Putting the whole event row or metadata in `pg_notify` can exceed the default payload limit. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]
**Why it happens:** PostgreSQL `NOTIFY` payload is a string and must be shorter than 8000 bytes in the default configuration. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]
**How to avoid:** Notify only compact identifiers, then query `pipeline_events`. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]
**Warning signs:** Inserts into `pipeline_events` fail at commit when metadata is large. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]

### Pitfall 4: Keepalive Tests Waiting 30 Seconds
**What goes wrong:** Test suite becomes slow or flaky. [ASSUMED]
**Why it happens:** Real timers are used for keepalive intervals. [CITED: https://main.vitest.dev/guide/mocking/timers]
**How to avoid:** Use Vitest fake timers for interval-driven helper tests, and keep route integration tests focused on behavior. [CITED: https://main.vitest.dev/guide/mocking/timers]
**Warning signs:** `npm test` takes over 30 seconds for a single SSE test. [ASSUMED]

## Code Examples

### Hono SSE Route Skeleton
```typescript
import { streamSSE } from 'hono/streaming'

jobs.get('/:id/events', async (c) => {
  const id = c.req.param('id')
  const job = await pool.query(`SELECT job_id FROM jobs WHERE job_id = $1`, [id])
  if (job.rows.length === 0) return httpError(c, 404, 'not_found', 'Job not found.')

  return streamSSE(c, async (stream) => {
    stream.onAbort(() => {
      // cleanup listener and interval here
    })
    await stream.writeSSE({
      id: 'event-uuid',
      event: 'pipeline_event',
      data: JSON.stringify({ event_id: 'event-uuid' }),
    })
  })
})
```
[CITED: https://hono.dev/docs/helpers/streaming; VERIFIED: api/src/routes/jobs.ts]

### Node-Postgres Listener Shape
```typescript
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
await client.query('LISTEN pipeline_events')
client.on('notification', (msg) => {
  const payload = msg.payload ? JSON.parse(msg.payload) : null
  // If payload.job_id matches the stream job, query pipeline_events after cursor.
})
```
[CITED: https://node-postgres.com/apis/client]

### SSE Keepalive Comment
```text
: keepalive

```
[CITED: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser polling `GET /jobs/:id/status` only | SSE progress stream plus polling/status endpoints | Phase 2 v3.0 scope | Frontend and bot get low-latency progress while DB remains canonical. [VERIFIED: .planning/REQUIREMENTS.md] |
| App-code-only notifications | Database trigger-backed notifications | Phase 2 locked decision | Python agent writes are observed without changing every writer. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md] |
| Notification payload as message body | Notification payload as wake-up id | Current PostgreSQL guidance | Avoids payload size and missed-message issues by querying durable rows. [CITED: https://www.postgresql.org/docs/17/sql-notify.html] |

**Deprecated/outdated:**
- WebSocket progress channel: explicitly out of v3.0 scope because SSE covers progress. [VERIFIED: .planning/REQUIREMENTS.md]
- Frontend live UI: deferred out of Phase 2. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A race can occur between replay completion and listener registration. | Common Pitfalls | Planner must include a setup-order test; otherwise a narrow missed-event window may remain. |
| A2 | A shared listener abstraction is not necessary for this single-user/self-hosted phase. | Standard Stack | If many concurrent SSE clients are expected, per-stream DB clients could exhaust the pool/server connection budget. |
| A3 | Keepalive tests can be helper-level with fake timers rather than only full route streaming tests. | Common Pitfalls | Planner may need more integration harness work if route-level timer behavior cannot be isolated. |

## Open Questions (RESOLVED)

1. **Should the implementation use one dedicated PostgreSQL client per SSE connection or one shared process-level listener?** [ASSUMED]
   - What we know: `LISTEN` is client-session behavior and node-postgres exposes notification events on `Client`. [CITED: https://node-postgres.com/apis/client]
   - What's unclear: Expected concurrent SSE connection count for web frontend plus bot is not specified. [VERIFIED: .planning/REQUIREMENTS.md]
   - RESOLVED: Use one dedicated PostgreSQL `pg.Client` per active SSE stream for Phase 2. The helper contract stays narrow so a future shared fanout can replace the internals if connection pressure becomes real, but this phase should not add shared listener complexity. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-02-PLAN.md]

2. **Should there be a synthetic `stream_end` event?** [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]
   - What we know: Terminal `pipeline_event` must be emitted first and stream must close. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]
   - What's unclear: Future clients may or may not need a distinct end marker. [ASSUMED]
   - RESOLVED: Do not add a synthetic `stream_end` event in Phase 2. The contract is: emit the terminal `pipeline_event` row, then close the SSE response cleanly. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | API build/test/runtime | Yes | v24.14.0 | Existing project uses Node tooling. [VERIFIED: local command output] |
| npm CLI | API package scripts and registry version checks | No | - | Use existing `api/node_modules/.bin/vitest` / `node`; install npm before dependency changes. [VERIFIED: local command output] |
| Hono | SSE route | Yes | 4.12.18 | None needed. [VERIFIED: api/node_modules/hono/package.json] |
| `pg` | DB queries and listener | Yes | 8.20.0 | None needed. [VERIFIED: api/node_modules/pg/package.json] |
| Vitest | TDD and validation | Yes | 4.1.5 | Run via `node api/node_modules/vitest/vitest.mjs run` if npm remains unavailable. [VERIFIED: api/node_modules/vitest/package.json] |
| PostgreSQL server | Runtime SSE source | Not probed successfully | - | Mock at boundary for unit/route tests; integration requires configured DB. [VERIFIED: local command output] |
| Docker | Not required for Phase 2 | Not probed successfully | - | Not needed for SSE. [VERIFIED: .planning/REQUIREMENTS.md] |

**Missing dependencies with no fallback:**
- `npm` is missing if the executor wants to run `npm test`; use local Vitest binary or install npm before package management. [VERIFIED: local command output]

**Missing dependencies with fallback:**
- Live PostgreSQL availability was not confirmed; Phase 2 can still be planned with mocked `pg` route tests and a migration file, while manual/integration verification can run against the configured DB later. [VERIFIED: local command output; ASSUMED]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 [VERIFIED: api/node_modules/vitest/package.json] |
| Config file | none; default Vitest config via package script [VERIFIED: api/package.json; local file scan] |
| Quick run command | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts` [VERIFIED: api/node_modules/vitest/package.json] |
| Full suite command | `cd api && node node_modules/vitest/vitest.mjs run` [VERIFIED: api/package.json; local environment npm missing] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SSE-01 | Streams prior and live pipeline rows as `event: pipeline_event` with `id` equal to `event_id`. | route/helper integration with mocked pg | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts -t "streams pipeline events"` | Existing file, new tests needed. [VERIFIED: api/src/routes/jobs.test.ts] |
| SSE-02 | Replays all rows initially and honors `Last-Event-ID` cursor. | route SQL behavior test | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts -t "Last-Event-ID"` | Existing file, new tests needed. [VERIFIED: api/src/routes/jobs.test.ts] |
| SSE-03 | Emits terminal row then closes for `approved`, `low_match`, or `error`. | route/helper integration | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts -t "terminal"` | Existing file, new tests needed. [VERIFIED: api/src/routes/jobs.test.ts] |
| SSE-04 | Sends `: keepalive\n\n` every 30 seconds while open. | helper test with fake timers | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts -t "keepalive"` | Existing file, helper may need new file. [CITED: https://main.vitest.dev/guide/mocking/timers] |
| SSE-05 | Missing job returns 404; missing API key returns 401 through mounted app. | app-level route test | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts src/middleware/apiKey.test.ts` | Existing files, new test needed. [VERIFIED: api/src/index.ts; api/src/routes/jobs.test.ts] |

### Sampling Rate
- **Per task commit:** `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts` [VERIFIED: local environment]
- **Per wave merge:** `cd api && node node_modules/vitest/vitest.mjs run` [VERIFIED: local environment]
- **Phase gate:** Full suite green plus TypeScript build through `cd api && node node_modules/typescript/bin/tsc`. [VERIFIED: api/package.json; api/node_modules/typescript/package.json]

### Wave 0 Gaps
- [ ] Add SSE route tests to `api/src/routes/jobs.test.ts` for replay, cursor, auth, terminal close, and live delivery. [VERIFIED: api/src/routes/jobs.test.ts]
- [ ] Add optional `api/src/sse.test.ts` or similar if frame/keepalive helpers become nontrivial. [ASSUMED]
- [ ] Add migration `database/003_pipeline_events_notify.sql` and a schema update for the trigger. [VERIFIED: database migration pattern]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing `X-API-Key` middleware with timing-safe comparison. [VERIFIED: api/src/middleware/apiKey.ts] |
| V3 Session Management | no | No user sessions; API key only. [VERIFIED: .planning/REQUIREMENTS.md] |
| V4 Access Control | yes | Single-user route-group protection on `/jobs/*`; no per-user authorization in scope. [VERIFIED: .planning/REQUIREMENTS.md; api/src/index.ts] |
| V5 Input Validation | yes | Parameterized SQL for `job_id` and `Last-Event-ID`; missing job returns 404. [VERIFIED: AGENTS.md; api/src/routes/jobs.ts pattern] |
| V6 Cryptography | no new crypto | Do not change API key comparison or profile encryption in this phase. [VERIFIED: api/src/middleware/apiKey.ts; .planning/REQUIREMENTS.md] |

### Known Threat Patterns for Hono SSE + PostgreSQL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized event stream access | Information Disclosure | Inherit `/jobs/*` API key middleware and add app-level 401 test. [VERIFIED: api/src/index.ts] |
| SQL injection through route id or Last-Event-ID | Tampering | Use parameterized queries only. [VERIFIED: AGENTS.md] |
| Long-lived stream resource leak | Denial of Service | Register `stream.onAbort()` cleanup for timers and DB listeners. [CITED: https://hono.dev/docs/helpers/streaming] |
| Sensitive metadata leakage in logs | Information Disclosure | Do not log full `metadata`; existing logger avoids request body/secret logging. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md; api/src/middleware/logger.ts] |

## Sources

### Primary (HIGH confidence)
- Local phase context: `.planning/phases/02-sse-pipeline-progress/02-CONTEXT.md` - locked SSE decisions, payload shape, cursor semantics, testing scope. [VERIFIED: local file]
- Local requirements: `.planning/REQUIREMENTS.md` - SSE-01 through SSE-05 and v3.0 scope. [VERIFIED: local file]
- Local project state: `.planning/STATE.md` - Phase 1 complete, pending migration note, v3.0 decisions. [VERIFIED: local file]
- Local code: `api/src/index.ts`, `api/src/routes/jobs.ts`, `api/src/errors.ts`, `api/src/db.ts`, `api/src/middleware/apiKey.ts`, `database/schema.sql`. [VERIFIED: local files]
- Hono streaming helper docs - `streamSSE()`, abort callback, streaming error caveat. [CITED: https://hono.dev/docs/helpers/streaming]
- node-postgres Client API - `notification` event shape and `LISTEN` example. [CITED: https://node-postgres.com/apis/client]
- PostgreSQL NOTIFY docs - trigger recommendation, transaction timing, payload limit, queue notes. [CITED: https://www.postgresql.org/docs/17/sql-notify.html]
- MDN SSE docs - `text/event-stream`, custom events, double-newline framing, comment keepalive. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events]
- Vitest timer docs - fake timers for interval tests. [CITED: https://main.vitest.dev/guide/mocking/timers]

### Secondary (MEDIUM confidence)
- Web search package references for Hono 4.12.18, pg 8.20.0, Vitest 4.1.5 because `npm` CLI was unavailable. [VERIFIED: web search]

### Tertiary (LOW confidence)
- None used as authoritative support. [VERIFIED: research notes]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing dependencies are installed locally and official docs cover the needed APIs. [VERIFIED: api/package.json; api/node_modules; official docs]
- Architecture: HIGH - major design choices are locked in CONTEXT.md and match PostgreSQL/Hono documented behavior. [VERIFIED: .planning/phases/02-sse-pipeline-progress/02-CONTEXT.md; official docs]
- Pitfalls: MEDIUM - PostgreSQL/Hono pitfalls are verified, but setup race and concurrency strategy need implementation-specific tests. [CITED: official docs; ASSUMED]

**Research date:** 2026-05-13 [VERIFIED: system date]
**Valid until:** 2026-06-12 for package/API guidance; re-check Hono and pg docs before implementation if delayed. [ASSUMED]
