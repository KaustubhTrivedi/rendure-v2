---
phase: 02-sse-pipeline-progress
reviewed: 2026-05-14T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - api/src/routes/jobs.ts
  - api/src/routes/jobs.test.ts
  - api/src/sse.ts
  - api/src/pg-listener.ts
  - api/src/pg-listener.test.ts
  - api/src/errors.ts
  - api/src/middleware/apiKey.ts
  - api/src/middleware/logger.ts
  - api/src/index.ts
  - api/src/routes/profile.ts
  - database/003_pipeline_events_notify.sql
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The SSE pipeline-progress implementation is structurally sound: the replay-then-listen pattern with an immediate catch-up query correctly closes the replay→LISTEN race window, and the flushing/flushAgain serialization prevents concurrent cursor queries. The auth middleware, error shape, and SQL parameterization are all correct.

Two critical issues were found: the `pg.Client` in `pg-listener.ts` has no `error` event handler, which causes an unhandled exception that crashes the Node.js process if the dedicated LISTEN connection drops; and the duplicate-URL check in `POST /jobs` permanently blocks re-submission of URLs whose prior pipeline run ended in a terminal error (`error`, `low_match`). Four warnings cover a DB-error leak in the SSE cursor loop, a key-length side-channel in the API key middleware, a missing field in `patchProfileSchema`, and an idempotency gap in `DELETE /profile/api-key`. Two info items cover the URL length cap and an unused `_callbacks` property in the test helper.

---

## Critical Issues

### CR-01: No `error` event handler on `pg.Client` — crashes the process on connection drop

**File:** `api/src/pg-listener.ts:15-37`

**Issue:** `pg.Client` is a Node.js `EventEmitter`. If the dedicated LISTEN connection is interrupted (network blip, DB restart, idle-connection timeout), the `pg` driver emits an `error` event on the client. Because no `error` listener is registered, Node.js's default behaviour is to throw the error as an uncaught exception, which crashes the entire API process. Every active SSE subscriber gets disconnected and the server goes down.

**Fix:** Register a no-op (or logging) `error` handler on the client before connecting, and signal the caller so it can close the stream gracefully:

```typescript
export async function listenForPipelineEvents(
  onEvent: (notification: PipelineNotification) => void,
  onError?: (err: Error) => void,
): Promise<PipelineEventListener> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

  // Prevent uncaught-exception crash on connection drop
  client.on('error', (err) => {
    onError?.(err)
  })

  await client.connect()
  // ... rest unchanged
}
```

The SSE route should pass an `onError` handler that sets `closed = true`, clears the keepalive interval, and resolves `closePromise` (optionally emitting a `stream_error` event to the client first).

---

### CR-02: Duplicate-URL check permanently blocks re-submission after terminal failure

**File:** `api/src/routes/jobs.ts:46-61`

**Issue:** The deduplication query at line 47 has no filter on `status`:

```sql
SELECT job_id, status FROM jobs WHERE job_url = $1
```

If a job previously reached `error` or `low_match` (both terminal states from which the pipeline cannot continue), any re-submission of the same URL returns `409 Conflict` forever. The user cannot retry a failed job without manual DB intervention, even though the schema and `CLAUDE.md` make no claim that URLs are permanently unique.

The DB partial unique index (`jobs_url_unique`) only prevents duplicate active rows at the constraint level, but the application-level check fires first and is more restrictive.

**Fix:** Exclude terminal statuses from the duplicate check so the user can re-submit:

```typescript
const existing = await pool.query(
  `SELECT job_id, status FROM jobs
   WHERE job_url = $1
     AND status NOT IN ('error', 'low_match', 'approved')`,
  [url]
)
```

If re-submitting an `approved` job should also be allowed (or should surface the approved result), adjust the exclusion list accordingly. The DB unique index will need the same `WHERE` predicate updated to match.

---

## Warnings

### WR-01: DB error in `sendRowsAfterCursor` silently swallows and leaks the stream open

**File:** `api/src/routes/jobs.ts:189-229`

**Issue:** The `catch` block at line 223 swallows all exceptions from the pool query and the `stream.writeSSE` loop:

```typescript
} catch {
  // Stream may have closed
}
```

If the database is temporarily unavailable during a notification-triggered cursor query, the error is discarded. `closed` remains `false`, the keepalive interval keeps firing, `resolveClose` is never called, and the SSE connection is held open indefinitely (until the client disconnects). The client receives no indication that events may have been missed.

**Fix:** On a caught DB error, emit a `stream_error` event and resolve the close promise:

```typescript
} catch (err) {
  if (!closed) {
    try {
      await stream.writeSSE({
        event: 'stream_error',
        data: JSON.stringify({ error: 'Stream interrupted.' }),
      })
    } catch { /* write failed — stream already gone */ }
    closed = true
    clearInterval(keepalive)
    if (listener) await listener.close().catch(() => undefined)
    resolveClose!()
  }
}
```

---

### WR-02: API key length comparison leaks expected key length (timing side-channel)

**File:** `api/src/middleware/apiKey.ts:41-43`

**Issue:** The early-exit length check:

```typescript
if (expectedBuf.length !== providedBuf.length) {
  return httpError(c, 401, 'unauthorized', 'Unauthorized')
}
```

reveals the byte-length of `RENDURE_API_KEY` to an unauthenticated attacker via timing. An attacker can determine the exact key length by measuring response time: requests with the wrong length return in microseconds (no `timingSafeEqual` call), while requests with the correct length return slightly later. This halves the brute-force search space for short keys.

**Fix:** Pad both buffers to the same length before comparing, keeping `timingSafeEqual` the sole discriminator:

```typescript
const maxLen = Math.max(expectedBuf.length, providedBuf.length)
const paddedExpected = Buffer.alloc(maxLen)
const paddedProvided = Buffer.alloc(maxLen)
expectedBuf.copy(paddedExpected)
providedBuf.copy(paddedProvided)

if (!timingSafeEqual(paddedExpected, paddedProvided)) {
  return httpError(c, 401, 'unauthorized', 'Unauthorized')
}
```

---

### WR-03: `notify_email` is permanently unwriteable via the API

**File:** `api/src/routes/profile.ts:19` and `api/src/routes/profile.ts:34-49`

**Issue:** `notify_email` is included in `SELECT_COLUMNS` (returned on every `GET /profile` and `PATCH /profile` response, line 19) but is absent from `patchProfileSchema` and from the `POST /profile` body. The column exists in the database schema (`database/001_user_profile.sql:38`). There is no endpoint that allows a user to set or update their notification email address, even though the field is surfaced in every profile response, implying it is meant to be user-configurable.

**Fix:** Add `notify_email` to `patchProfileSchema` with email format validation:

```typescript
notify_email: z.string().email().nullable().optional(),
```

If the column is intentionally read-only or not yet implemented, remove it from `SELECT_COLUMNS` and add a comment explaining the deferral.

---

### WR-04: `DELETE /profile/api-key` is non-idempotent — returns 200 when no profile exists

**File:** `api/src/routes/profile.ts:194-199`

**Issue:** The `DELETE /profile/api-key` handler executes `UPDATE ... WHERE id = 1` unconditionally and always returns `{ ok: true }` regardless of whether any row was matched. If no profile has been created yet, `rowCount` is 0, the update silently no-ops, and the caller receives a success response. This is misleading and inconsistent with `PATCH /profile`, which correctly returns 404 when no profile row exists.

**Fix:** Check `result.rowCount` and return 404 if no row was matched:

```typescript
profile.delete('/api-key', async (c) => {
  const result = await pool.query(
    `UPDATE user_profile SET openrouter_api_key_enc = NULL, updated_at = NOW()
     WHERE id = 1`,
  )
  if (result.rowCount === 0) {
    return httpError(c, 404, 'profile_not_found', 'No profile found.')
  }
  return c.json({ ok: true })
})
```

---

## Info

### IN-01: No maximum length validation on submitted URLs

**File:** `api/src/routes/jobs.ts:36-43`

**Issue:** The `POST /jobs` handler validates that `url` is a non-empty string and passes `new URL()` parsing, but imposes no upper bound on URL length. An arbitrarily long string is inserted directly into the `jobs.job_url` column and passed as a shell argument to `spawn`. PostgreSQL's `TEXT` type has no practical limit, but very long URLs could inflate `pg_notify` payloads or the `spawn` argument array in edge cases.

**Fix:** Add a reasonable length cap before the `new URL()` check:

```typescript
if (url.length > 2048) {
  return httpError(c, 400, 'bad_request', 'url must not exceed 2048 characters.')
}
```

---

### IN-02: `_callbacks` property in test helper is stale after `reset()`

**File:** `api/src/pg-listener.test.ts:33`

**Issue:** The `triggerNotification` object returned by `vi.hoisted` exposes `_callbacks` as a direct reference to the initial empty array. `reset()` reassigns the local `callbacks` variable to a new array, but `_callbacks` still points to the original array. Any test code that reads `triggerNotification._callbacks` after `reset()` would see stale data. The property is currently unused by any test, so there is no active bug, but it is misleading and could cause confusing failures if a future test relies on it.

**Fix:** Remove `_callbacks` from the returned object since it is unused, or make it a getter:

```typescript
get _callbacks() { return callbacks }
```

---

_Reviewed: 2026-05-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
