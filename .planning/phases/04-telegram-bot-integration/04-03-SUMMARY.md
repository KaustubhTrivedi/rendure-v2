---
phase: 04-telegram-bot-integration
plan: 03
subsystem: api
tags: [typescript, tdd, telegram, webhook, hono]
requires:
  - 04-01 (shared submitJobUrl helper + JobSubmitResult types)
provides:
  - Telegram webhook POST /telegram with Telegram-secret authentication
  - URL extraction from Telegram message text
  - Pipeline submission via submitJobUrl with response mapping
affects:
  - 04-telegram-bot-integration (Plan 04-04 terminal notification listener may interact with webhook)
tech-stack:
  added: []
  patterns:
    - "Route-level middleware composition for config gate + auth gate"
    - "Hono route mounted before API-key middleware to bypass X-API-Key auth"
    - "submitJobUrl caller-pays mapping to httpError vs c.json based on statusCode discriminator"
key-files:
  created:
    - api/src/routes/telegram.ts
    - api/src/routes/telegram.test.ts
  modified:
    - api/src/index.ts
    - api/src/app.test.ts
key-decisions:
  - "Telegram route mounted at /telegram BEFORE /jobs/* and /profile/* auth middleware so Telegram webhook requests don't need X-API-Key"
  - "Middleware composition: config gate (503) runs before secret gate (401) — missing env vars are caught before header check"
  - "Response format: all responses are { text: string } JSON to match Telegram Bot API response expectations"
  - "URL extraction uses simple /https?:\\/\\/[^\\s]+/g regex — sufficient for Telegram message parsing"
  - "Zero or multiple URLs both return friendly help without calling submitJobUrl"
metrics:
  duration: 1 min
  completed_at: "2026-05-21T15:45:00Z"
  test_count: 19
  test_pass: 19
  build_clean: true
---

# Phase 04 Plan 03: Telegram Webhook Route — Summary

Telegram Bot API webhook receiver at POST /telegram with dual middleware gates (config check + secret header verification), URL extraction from message text, pipeline submission via shared submitJobUrl helper, and friendly response text for invalid inputs.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `0cdc8e5` | test | RED: add failing tests for telegram webhook route (11 test cases) |
| `526c79a` | feat | GREEN: implement telegram webhook route (config gate, secret gate, URL handling) |
| `c591898` | feat | Mount telegram route in app + app-level auth regression tests |

## Tasks Completed

### Task 1 & 2: Telegram route implementation (TDD RED-GREEN)
- Created `api/src/routes/telegram.ts` with:
  - **Config gate middleware**: checks `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` — returns 503 problem JSON if either is missing
  - **Secret gate middleware**: verifies `X-Telegram-Bot-Api-Secret-Token` header matches `TELEGRAM_WEBHOOK_SECRET` — returns 401 problem JSON if missing/wrong
  - **POST /** handler: parses Telegram Update JSON, extracts URLs from message text, submits via `submitJobUrl`
- Created `api/src/routes/telegram.test.ts` with 11 test cases:
  - Config gate: missing `TELEGRAM_BOT_TOKEN` → 503, missing `TELEGRAM_WEBHOOK_SECRET` → 503
  - Secret gate: missing header → 401, wrong header → 401, correct header → proceeds
  - URL handling: `/start` → friendly text, no URL → friendly text, single valid URL → 202 + calls submitJobUrl, duplicate → existing status, zero URLs → no job created, multiple URLs → no job created

### Task 3: App mounting and regression tests
- Updated `api/src/index.ts` — import and mount `/telegram` route after global logger, before API-key middleware
- Updated `api/src/app.test.ts` — added 4 tests:
  - POST /telegram does not require X-API-Key (uses Telegram secret)
  - POST /telegram without Telegram secret returns 401
  - /jobs/* still returns 401 without X-API-Key when telegram route is mounted
  - /profile/* still returns 401 without X-API-Key when telegram route is mounted

## Verification Results

| Criteria | Result |
|----------|--------|
| `src/routes/telegram.test.ts` | ✅ 11/11 passed |
| `src/app.test.ts` | ✅ 8/8 passed (4 existing + 4 new) |
| Full test suite `npm test` | ✅ 120 passed, 1 skipped, 11 files |
| `npm run build` (tsc) | ✅ Clean, no errors |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- [x] `api/src/routes/telegram.ts` exists and contains route implementation
- [x] `api/src/routes/telegram.test.ts` exists and contains 11 tests
- [x] `api/src/index.ts` imports and mounts telegram route
- [x] `api/src/app.test.ts` has telegram app-level tests
- [x] Commit `0cdc8e5` exists (RED)
- [x] Commit `526c79a` exists (GREEN)
- [x] Commit `c591898` exists (app mount + tests)
- [x] All 120 tests pass
- [x] Build compiles cleanly
