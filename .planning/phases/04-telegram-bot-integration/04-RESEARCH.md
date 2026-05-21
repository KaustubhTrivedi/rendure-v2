# Phase 4 Research: Telegram Bot Integration

**Date:** 2026-05-21
**Scope:** Backend-only Telegram webhook intake and terminal-state outbound notifications for the existing Hono/TypeScript API.

## Discovery Level

Level 2 — external integration with Telegram Bot API plus existing backend reuse.

## External API Findings

- Telegram webhooks deliver JSON `Update` objects with optional `message.text` and `message.chat.id`.
- `setWebhook` supports `secret_token`; when configured, Telegram sends `X-Telegram-Bot-Api-Secret-Token` on every webhook request.
- Secret token constraints: 1–256 chars, `A-Z`, `a-z`, `0-9`, `_`, `-`.
- Bot API requests use `https://api.telegram.org/bot<token>/METHOD_NAME` over HTTPS.
- `sendMessage` accepts JSON with `chat_id`, `text`, optional `parse_mode`; response body has boolean `ok` and optional `description`.
- Telegram retries webhook delivery on non-2xx responses, so handled non-job messages should return 2xx.

## Chosen Integration Pattern

- Add a public `/telegram/webhook` route group mounted outside `/jobs/*` and `/profile/*` API-key middleware.
- Authenticate `/telegram/webhook` with exact `X-Telegram-Bot-Api-Secret-Token` match against `TELEGRAM_WEBHOOK_SECRET`.
- Treat missing `TELEGRAM_BOT_TOKEN` or `TELEGRAM_WEBHOOK_SECRET` as route-level 503 `not configured`, not server startup failure.
- Extract existing job submission behavior from `api/src/routes/jobs.ts` into a shared helper so the Telegram route and `POST /jobs` use one implementation for validation, duplicate lookup, insertion, pipeline spawn, and status URLs.
- Use Node 20+ built-in `fetch` for Telegram Bot API calls; do not add a dependency.
- Use `MarkdownV2` only when all dynamic content is escaped. Escape role/company/status/QA/gaps/job IDs/API paths before sending.
- Reuse `listenForPipelineEvents()` as a wake-up mechanism and re-query canonical rows for terminal jobs before sending outbound notifications.

## Existing Code Patterns to Follow

- Hono route modules live under `api/src/routes/*` and are mounted from `api/src/index.ts`.
- All route errors use `httpError()` from `api/src/errors.ts`.
- Route tests use Vitest and mock `pool.query`, `spawn`, `fetch`, and `listenForPipelineEvents` at external boundaries only.
- `TERMINAL_STATUSES` / `isTerminalStatus()` from `api/src/sse.ts` define `approved`, `low_match`, and `error`.
- Resume retrieval paths already exist: `/jobs/:id/resume/:version_id` and `/jobs/:id/resume/:version_id/pdf`.

## Security Notes

- Webhook requests are untrusted public input. Validate body shape, URL text, and exact secret token before job submission.
- Do not require `X-API-Key` on `/telegram/webhook`; the Telegram secret token is the route-specific authenticator.
- Never log or return `TELEGRAM_BOT_TOKEN` or raw internal errors.
- Outbound error notifications must not include stack traces or raw exception detail.
- Use parameterized SQL for all reads.

## User Setup Required

- `TELEGRAM_BOT_TOKEN`: token created through BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: server-side secret used when calling Telegram `setWebhook(secret_token=...)`.
- User must configure the Telegram webhook URL with BotFather/Bot API using the same secret once the deployment URL is known.

## Deferred by Context

- Inline keyboards, `/status`, multi-step setup, rich bot UX.
- Auto-storing chat IDs from incoming updates.
- Absolute public URL generation for resume links.
