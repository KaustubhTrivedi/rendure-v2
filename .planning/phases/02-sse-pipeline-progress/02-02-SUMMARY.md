# Phase 2, Plan 02 Summary: DB NOTIFY Trigger + Listener Helper

**Date:** 2026-05-13
**Status:** Complete ✓

## Deliverables

### New file: `database/003_pipeline_events_notify.sql`
- Idempotent migration: `CREATE OR REPLACE FUNCTION notify_pipeline_event()`
- `AFTER INSERT ON pipeline_events` trigger `trg_notify_pipeline_event`
- Notifies on channel `pipeline_events` with compact JSON: `{job_id, event_id}` only
- No `metadata`, `detail`, or full row content in NOTIFY payload

### Modified file: `database/schema.sql`
- Mirrors the same `notify_pipeline_event` function and `trg_notify_pipeline_event` trigger

### New file: `api/src/pg-listener.ts`
- `listenForPipelineEvents(onEvent)` — creates dedicated `pg.Client`, connects, registers `notification` handler, `LISTEN pipeline_events`
- Notification handler parses JSON payload, validates `job_id` and `event_id` are strings, invokes callback
- Silent on malformed/incomplete payloads (notification is wake-up; route re-queries canonical rows)
- Returns `PipelineEventListener` with `close()` that `UNLISTEN`s and `end()`s

### New file: `api/src/pg-listener.test.ts`
8 tests across 2 describe blocks:

| Describe | Test | What it proves |
|----------|------|---------------|
| Migration | Defines function | SQL contains `CREATE OR REPLACE FUNCTION` |
| Migration | pg_notify on pipeline_events | Correct channel name |
| Migration | job_id and event_id only | Migration accepts grep checks |
| Migration | No metadata in payload | Security: grep-rejected |
| Listener | Creates client, connects, LISTENs | Dedicated client lifecycle |
| Listener | Valid notification invokes callback | Parse → validate → call |
| Listener | Malformed/incomplete ignored | Swallow errors |
| Listener | close() unlistens + ends | Cleanup exactly once |

## Verification
- `cd api && npm run test` — 63/63 passed (7 files)
- `cd api && npm run build` — tsc compiles cleanly
- All acceptance criteria (grep checks) passed
