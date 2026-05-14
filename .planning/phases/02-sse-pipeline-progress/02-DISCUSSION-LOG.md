# Phase 2: SSE Pipeline Progress - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 02-sse-pipeline-progress
**Areas discussed:** Live delivery strategy, SSE payload shape, replay cursor, keepalive and terminal close

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| All areas | Event payload, replay, live delivery, keepalive/close, and tests | yes |
| Protocol only | Event names, IDs, payload shape, reconnect semantics | |
| Ops behavior | Keepalive interval, terminal close, DB polling/listen strategy, error handling | |

**User's choice:** All Areas.

---

## Live Delivery Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres LISTEN/NOTIFY | Efficient live updates; still uses DB replay on reconnect | yes |
| Short polling loop inside SSE handler | Simpler, but each open stream periodically queries Postgres | |
| In-memory broadcaster from API writes only | Fast, but misses Python-agent DB writes unless every writer also publishes | |

**User's choice:** Postgres LISTEN/NOTIFY.
**Notes:** Because pipeline events are written outside the API by Python agents, planning must ensure notifications fire for every database insert, not only API-originated writes.

---

## SSE Payload Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Full pipeline event row | Emits event ID, type, agent, statuses, detail, metadata, timestamp, and related row fields | yes |
| Minimal status update | Emits only status, detail, and timestamp | |
| Mixed shape by event type | Varies payload by event kind | |

**User's choice:** Full pipeline event row.
**Notes:** Schema check confirmed `pipeline_events` uses `timestamp`, not `created_at`.

---

## Replay Cursor

| Option | Description | Selected |
|--------|-------------|----------|
| SSE `id:` as `pipeline_events.event_id` | Standard reconnect mechanism via `Last-Event-ID` | yes |
| Timestamp cursor query param | Readable, but easier to duplicate or skip on precision/tie cases | |
| Always replay all events | Simplest server logic, but forces client dedupe every time | |

**User's choice:** Use SSE `id:` as `pipeline_events.event_id`.

---

## Keepalive And Terminal Close

| Option | Description | Selected |
|--------|-------------|----------|
| Keepalive every 30s, close after terminal final event | Proxy-friendly default and matches phase success criteria | yes |
| Keepalive every 15s | More aggressive, more chatter | |
| Keep stream open after terminal | Contradicts success criteria | |

**User's choice:** Keepalive every 30 seconds, close after terminal final event.
**Notes:** Terminal statuses are `approved`, `low_match`, and `error`.

---

## the agent's Discretion

- Exact helper/module split for stream formatting and Postgres listening.
- Whether to add a final synthetic stream-end event after the terminal pipeline row.
- Exact test fixture structure for notification simulation.

## Deferred Ideas

- Frontend progress UI decisions from earlier archived milestones were not carried into this backend-only phase.
- Telegram notifications remain Phase 4.
