# Backlog

Items deferred from active phases. Review before planning the next phase.

---

## From Phase 02 Code Review

### BL-01 — Add `error` handler to `pg.Client` in `pg-listener.ts` [critical]

**File:** `api/src/pg-listener.ts`

`pg.Client` emits an `error` event on connection drops. With no handler registered, Node.js promotes it to an uncaught exception, crashing the process and killing all active SSE streams.

**Fix:** Register `client.on('error', handler)` before `client.connect()` and propagate the error to the SSE route to close the stream gracefully.

---

### BL-02 — Dedup query in `jobs.ts` blocks re-submission after terminal failure [critical]

**File:** `api/src/routes/jobs.ts`

The `WHERE job_url = $1` dedup check has no status filter. Once a job reaches `error` or `low_match`, re-submitting the same URL returns `409 Conflict` forever with no recovery path.

**Fix:** Add `AND status NOT IN ('error', 'low_match', 'approved')` to the dedup query and align any DB partial unique index predicate to match.

---

### BL-03 — `sendRowsAfterCursor` catch block silently leaks SSE stream open [warning]

**File:** `api/src/routes/jobs.ts`

The bare `catch {}` swallows pool query failures — `closed` stays `false`, `resolveClose` is never called, the keepalive interval fires indefinitely, and the client gets no error signal.

**Fix:** In the catch block, emit `event: stream_error` with `{"error":"Stream failed."}`, set `closed = true`, clear the interval, and call `resolveClose()`.

---

### BL-04 — Timing side-channel in API key length check [warning]

**File:** `api/src/middleware/apiKey.ts`

Returning early when `expectedBuf.length !== providedBuf.length` allows an attacker to determine the byte-length of `RENDURE_API_KEY` via response timing.

**Fix:** Pad both buffers to `Math.max(expected.length, provided.length)` before calling `timingSafeEqual` to eliminate the timing difference.
