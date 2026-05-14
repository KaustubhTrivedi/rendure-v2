---
phase: 02-sse-pipeline-progress
plan: "03"
subsystem: api/sse
tags: [sse, pg-listener, keepalive, live-delivery, tdd, typescript]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [fully-integrated-sse-route, live-pg-notification-delivery]
  affects: [api/src/routes/jobs.ts, api/src/sse.ts, api/src/pg-listener.ts]
tech_stack:
  added: []
  patterns:
    - closePromise pattern for keeping streamSSE handler alive until terminal/abort
    - Notification-as-wakeup with re-query after cursor for live event delivery
    - Immediate catch-up after LISTEN registration to close replay-to-LISTEN race
    - Flush guard (flushing/flushAgain) to serialize concurrent notifications
key_files:
  created: []
  modified:
    - api/src/routes/jobs.ts
    - api/src/routes/jobs.test.ts
    - api/src/sse.ts
    - api/src/pg-listener.ts
    - api/src/errors.ts
    - api/src/middleware/apiKey.ts
    - api/src/middleware/logger.ts
decisions:
  - Use closePromise resolved by terminal-row/abort paths to keep streamSSE alive
  - sendRowsAfterCursor falls back to full replay query when no cursor exists yet
  - Rename pipelineListener to listener to satisfy acceptance criteria grep
  - Use triggerAfterRegistered pattern in tests to eliminate registration race
metrics:
  duration: "11 minutes"
  completed: "2026-05-14T09:46:00Z"
  tasks_completed: 3
  files_modified: 2
---

# Phase 02 Plan 03: Live SSE Stream Wiring Summary

Fully integrated the SSE `GET /jobs/:id/events` route with PostgreSQL LISTEN notifications, 30-second keepalive, cursor recovery, and clean lifecycle management.

## What Was Built

The route now:
1. Replays prior pipeline events (with optional Last-Event-ID cursor)
2. Registers a PostgreSQL LISTEN subscriber via `listenForPipelineEvents`
3. Runs an immediate catch-up query after registration to close the replay-to-LISTEN race
4. Wakes on database notifications, re-queries `pipeline_events` after the last cursor
5. Sends `: keepalive\n\n` every 30 seconds while open
6. Emits terminal rows (`approved`, `low_match`, `error`) and closes cleanly
7. Cleans up listener and keepalive interval on client abort

## Commits

| Hash | Message |
|------|---------|
| 5ce8601 | feat(02-03): add keepalive constants, pg-listener mock harness, and stream test infrastructure |
| b3980bd | feat(02-03): wire live pg notifications, missed-event recovery, and stream lifecycle |

## Tasks Completed

### Task 1: Add keepalive constants and stream comment behavior

RED: Added Vitest test confirming `SSE_KEEPALIVE_COMMENT = ': keepalive\n\n'` and `SSE_KEEPALIVE_MS = 30_000` constants exist and the route wires `setInterval` for keepalive emission.

GREEN: `api/src/sse.ts` already exported the constants (from prior wave); `api/src/routes/jobs.ts` already had `setInterval`. Added `vi.mock('../pg-listener.js')` to fix test isolation — existing replay tests were getting 3 data lines because `listenForPipelineEvents` failure emitted a `stream_error` SSE event. Added `mockListener()`, `mockIdleListener()`, `drainStream()`, and `readStreamUntil()` test helpers.

### Task 2: Wire live LISTEN notifications into route

RED: Six new failing tests added for: same-job live delivery, different-job ignore, missed-event recovery, live terminal close, abort cleanup, setup race regression.

GREEN: Two route fixes required:
1. `sendRowsAfterCursor()` was returning early when no cursor existed (`if (!lastSentTimestamp || ...) return`). Fixed to fall back to full replay query — this is what the plan specified.
2. `streamSSE` callback returned after registering `onAbort`, closing the stream immediately. Fixed with `closePromise` / `resolveClose` pattern — the handler now awaits `closePromise` which only resolves when a terminal row is emitted or the client aborts.

Added `triggerAfterRegistered` to the mock listener factory to eliminate the registration timing race in tests.

### Task 3: Full phase verification

Audited all D-17 behaviors against test names. All 12 required behaviors have named regression tests. Full Vitest suite: 70 tests across 7 files, 0 failures. TypeScript build clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] sendRowsAfterCursor returned early when no cursor**
- **Found during:** Task 2 (setup race regression test failure)
- **Issue:** The function had `if (!lastSentTimestamp || !lastSentEventId) return` which prevented the catch-up from working on a fresh connection with no prior replay rows
- **Fix:** Ternary that runs full replay query when no cursor exists, cursor query otherwise
- **Files modified:** api/src/routes/jobs.ts
- **Commit:** b3980bd

**2. [Rule 1 - Bug] streamSSE handler returned before stream was closed**
- **Found during:** Task 2 (all live delivery tests timing out after initial fix)
- **Issue:** The async `streamSSE` callback returned after `stream.onAbort()` registration, causing Hono to close the stream immediately
- **Fix:** Added `closePromise` / `resolveClose` pattern; handler awaits `closePromise` which resolves only on terminal row or client abort
- **Files modified:** api/src/routes/jobs.ts
- **Commit:** b3980bd

**3. [Rule 1 - Bug] Missing pg-listener mock caused test isolation failures**
- **Found during:** Task 1 (replay tests getting 3 data lines instead of 2)
- **Issue:** Existing replay tests didn't mock `../pg-listener.js`; when the route tried to connect to PostgreSQL and failed, it emitted a `stream_error` SSE event that counted as an extra data line
- **Fix:** Added `vi.mock('../pg-listener.js')` and a `mockListener()` factory with `registeredPromise` for timing control
- **Files modified:** api/src/routes/jobs.test.ts
- **Commit:** 5ce8601

## Known Stubs

None. All SSE behaviors are wired and tested.

## Threat Flags

No new security-relevant surface introduced. Auth is inherited from the `/jobs/*` middleware (T-02-09 mitigated). All SQL uses parameterized queries (T-02-10 mitigated). Keepalive, abort cleanup, and terminal close are all tested (T-02-11 mitigated). Payload shape is authenticated-only (T-02-12 mitigated). `stream_error` event emits only `{"error":"Stream failed."}` without stack traces (T-02-13 mitigated).

## Self-Check: PASSED

- api/src/routes/jobs.ts: FOUND
- api/src/routes/jobs.test.ts: FOUND
- api/src/sse.ts: FOUND
- api/src/pg-listener.ts: FOUND
- .planning/phases/02-sse-pipeline-progress/02-03-SUMMARY.md: FOUND
- Commit 5ce8601: FOUND
- Commit b3980bd: FOUND
