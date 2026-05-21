---
phase: 04-telegram-bot-integration
plan: 04
completed: 2026-05-21
duration: 9m
tasks:
  total: 3
  completed: 3
commits:
  - 65ac737: "feat(04-telegram-bot-integration): implement notifyTerminalJob query and send"
  - 4187b38: "feat(04-telegram-bot-integration): implement startTelegramTerminalNotifier with duplicate suppression"
  - 4d21f39: "feat(04-telegram-bot-integration): wire terminal notifier startup and add Telegram docs"
requirements: [TELEGRAM-03, TELEGRAM-04, TELEGRAM-05]
tags: [telegram, notifications, pipeline-events, pg-listen]
key-files:
  created:
    - api/src/telegram-notifier.ts
    - api/src/telegram-notifier.test.ts
  modified:
    - api/src/index.ts
    - README.md
---

# Phase 04 Plan 04: Terminal pipeline event Telegram notifications

Wire terminal pipeline events to outbound Telegram notifications via the existing `pg-listener` infrastructure — avoiding polling by using Postgres NOTIFY as a wake-up mechanism — with correct handling for unconfigured profiles (TELEGRAM-04) and unconfigured bot tokens (TELEGRAM-05).

## Decisions Made

1. **Canonical re-query pattern** — pg notification is treated as a wake-up only; `notifyTerminalJob` always re-queries the DB to get current job status, profile chat ID, and latest QA gaps via a parameterized SQL join across `jobs`, `user_profile`, `resume_versions`, and `qa_reviews`.
2. **In-memory duplicate suppression** — A module-scoped `Set<job_id>` prevents duplicate Telegram messages when multiple pipeline events arrive for the same terminal transition. Notifier exposes `__resetSentJobsForTests()` for test isolation.
3. **Non-fatal missing config** — Missing `TELEGRAM_BOT_TOKEN` returns a no-op notifier (no DB listener opened, no crash). Wired into `index.ts` alongside `checkRenderCvAvailable` with the same warn-on-failure pattern.
4. **Shutdown cleanup** — `SIGTERM`/`SIGINT` handlers close the underlying `listenForPipelineEvents` listener on server shutdown.

## Task Summary

### Task 1 — notifyTerminalJob (TDD: RED-GREEN-REFACTOR)

Created `api/src/telegram-notifier.ts` with `notifyTerminalJob(jobId: string)`:

- Parameterized SQL joins `jobs` × `user_profile` × latest `qa_reviews` (via `resume_versions` LATERAL join)
- Terminal status checked via `isTerminalStatus` from `sse.ts`
- Null/empty `notify_telegram_chat_id` returns `{ sent: false, reason: "telegram_chat_not_configured" }` without calling fetch (TELEGRAM-04)
- Non-terminal jobs return `{ sent: false, reason: "not_terminal" }` without calling fetch
- Send failures surface typed error reasons (never expose stack traces, per T-04-04-01)
- **11 tests:** approved variants (null company/role, null resume, null score), low_match with gaps, error, not_terminal, chat_not_configured (null + empty), send_failure, job_not_found

### Task 2 — startTelegramTerminalNotifier (TDD: RED-GREEN-REFACTOR)

- `startTelegramTerminalNotifier()` registers `listenForPipelineEvents` callback that calls `notifyTerminalJob`
- In-memory `sentJobs` Set blocks duplicate notifications for the same job_id within one process
- Missing bot token → returns no-op notifier without opening DB listener (TELEGRAM-05)
- Listener/send/query errors caught and logged, never crash the server
- **7 tests:** listener registration, notification forwarding, duplicate suppression, separate jobs, no-op mode, error logging, close cleanup

### Task 3 — Startup wiring and docs

- `index.ts` starts `startTelegramTerminalNotifier()` in non-test mode with SIGTERM/SIGINT cleanup
- README documents `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `/telegram` webhook setup, `X-Telegram-Bot-Api-Secret-Token`, `notify_telegram_chat_id` behavior, and notification types

## Deviations from Plan

None — plan executed as written.

## Threat Surface Scan

No new threat surface beyond what was modeled in Plan 04-04's threat register. The notifier uses existing DB read paths (no new tables/columns) and the existing `sendTelegramMessage` / `formatTelegramTerminalMessage` functions. Recipient comes only from `user_profile.notify_telegram_chat_id` (T-04-04-02). No new network endpoints or auth paths introduced.

## Verification Results

```
Test Files  4 passed (4)
     Tests  46 passed (46)

Build: tsc exited with 0
```

## Self-Check: PASSED

- [x] `api/src/telegram-notifier.ts` exists and exports `notifyTerminalJob`, `startTelegramTerminalNotifier`
- [x] `api/src/telegram-notifier.test.ts` exists with 18 tests
- [x] All 18 notifier tests pass
- [x] `api/src/app.test.ts` (8 tests) continues to pass
- [x] `npm run build` passes (tsc 0)
- [x] Commit 65ac737 exists ✓
- [x] Commit 4187b38 exists ✓
- [x] Commit 4d21f39 exists ✓
- [x] README.md updated with Telegram docs
