# Telegram Bot Integration

Rendure integrates with Telegram as a first-class client. You can submit job posting URLs through a Telegram bot and receive pipeline results as notifications — all through the same centralized Hono/TypeScript backend.

## Architecture

```
Telegram ──POST webhook──▶ /telegram/webhook ──▶ submitJobUrl(url) ──▶ PostgreSQL + Pipeline
                                    │                                        │
                                    │                                  (terminal status)
                                    │                                        │
                                    └── 200/202 ◀───────────────────────────┘
                                                                              │
                                                                    pipeline_events
                                                                    NOTIFY trigger
                                                                              │
                                                                              ▼
                                                              listenForPipelineEvents
                                                                              │
                                                                              ▼
                                                              notifyTerminalJob(job_id)
                                                                              │
                                                                              ▼
                                                              sendTelegramMessage(chatId, text)
```

Two independent integration paths:

- **Webhook intake** — Telegram sends user messages to `POST /telegram/webhook`. The route validates auth, extracts URLs, and submits them through the shared `submitJobUrl` helper.
- **Terminal notifications** — A background listener watches for `pipeline_events` NOTIFY messages, checks if the job reached a terminal state, and sends a Telegram message via the Bot API.

## Files

| File | Purpose |
|------|---------|
| `api/src/routes/telegram.ts` | Webhook receiver route |
| `api/src/telegram.ts` | Message formatting, MarkdownV2 escaping, Bot API client |
| `api/src/telegram-notifier.ts` | Terminal event listener and notification dispatcher |
| `api/src/job-submission.ts` | Shared URL submission helper (also used by `POST /jobs`) |

## Setup

### 1. Create a bot

Talk to [@BotFather](https://t.me/BotFather) on Telegram to create a bot. Save the token.

### 2. Set environment variables

```dotenv
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_WEBHOOK_SECRET=your-arbitrary-webhook-secret
```

If both are set, Telegram features are fully active. If either is missing, the server starts normally but:

- `POST /telegram/webhook` returns `503` with code `telegram_not_configured`
- The terminal notifier starts as a no-op

### 3. Apply the database migration

```bash
psql $DATABASE_URL -f database/002_telegram.sql
```

This adds the `user_profile.notify_telegram_chat_id` column. A row must exist in `user_profile` with `id = 1` (created by `POST /profile`).

### 4. Configure your chat ID

Get your Telegram chat ID by messaging [@userinfobot](https://t.me/userinfobot). Then set it on your profile:

```bash
curl -X PATCH http://localhost:3002/profile \
  -H 'X-API-Key: your-key' \
  -H 'Content-Type: application/json' \
  -d '{"notify_telegram_chat_id": "123456789"}'
```

Set it to `null` to disable Telegram notifications:

```bash
curl -X PATCH http://localhost:3002/profile \
  -H 'X-API-Key: your-key' \
  -H 'Content-Type: application/json' \
  -d '{"notify_telegram_chat_id": null}'
```

### 5. Register the webhook with Telegram

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-host.com/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

- `<TELEGRAM_BOT_TOKEN>` is the token from BotFather.
- `url` must be HTTPS. For local testing, use a tunnel like `ngrok` or `bore`.
- `secret_token` is the same value as `TELEGRAM_WEBHOOK_SECRET` in `.env`.
- Telegram includes this secret as the `X-Telegram-Bot-Api-Secret-Token` header on every webhook request. The server rejects requests without a matching token.

Verify the webhook is set:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Usage

### Submitting a job

Send any job posting URL to your bot. The server:

1. Validates the URL is parseable.
2. Checks for a duplicate by URL.
3. Inserts a `jobs` row and spawns the pipeline.
4. Sends a 202 response with the job ID and status URL.
5. Telegram displays the response as the bot's reply.

**Example interaction:**

```
User:  https://boards.greenhouse.io/example/jobs/123
Bot:   ✅ Job submitted!
       Job ID: abc-123
       Status: /jobs/abc-123/status
```

**Duplicate URL:**

```
User:  https://boards.greenhouse.io/example/jobs/123
Bot:   ⚠️ This URL was already submitted.
       Job ID: abc-123
       Status: /jobs/abc-123/status (in_progress)
```

**Non-URL message:**

```
User:  hello
Bot:   🤖 Send a job posting URL and I'll submit it to the pipeline.
```

**Multiple URLs:**

```
User:  https://example.com/job1 https://example.com/job2
Bot:   📎 Please send a single job posting URL per message.
```

### `/start` command

Sending `/start` always returns help text describing how to use the bot.

### Receiving notifications

When a pipeline run finishes, the bot sends you a message automatically if `notify_telegram_chat_id` is set.

**Approved:**
```
✅ Status: Approved
QA Score: 0.950
Role: Staff Engineer @ Example Inc
Resume: /jobs/abc-123/resume/ver-456
PDF: /jobs/abc-123/resume/ver-456/pdf
```

**Low match:**
```
⚠️ Status: Low Match
QA Score: 0.650

Key Gaps:
• No experience with Kubernetes mentioned in resume
• Missing relevant AWS service experience
```

**Error:**
```
❌ Status: Error

Tailoring failed for your job posting. The pipeline encountered an error before completing.

Check status: /jobs/abc-123/status
```

## API Reference

### `POST /telegram/webhook`

Authenticated by `X-Telegram-Bot-Api-Secret-Token` header. Does **not** require `X-API-Key`.

**Request body** (Telegram Update):
```json
{
  "update_id": 123456789,
  "message": {
    "text": "https://example.com/job",
    "chat": { "id": 987654321 }
  }
}
```

**Responses:**

| Condition | Status | Body |
|-----------|--------|------|
| Valid single URL | `202` | `{ "ok": true, "job_id": "...", "status": "new", "status_url": "/.../status" }` |
| Duplicate URL | `409` | `{ "error": "...", "job_id": "...", "status": "...", "status_url": "..." }` |
| `/start` or non-URL | `200` | `{ "ok": true, "text": "Send a job posting URL..." }` |
| Invalid secret | `401` | Problem JSON |
| Missing config | `503` | Problem JSON with `code: "telegram_not_configured"` |
| Malformed body | `200` | (ignored, no retry) |

## Development

### Testing

Tests use Vitest with mocked database and Telegram API boundaries.

```bash
cd api && npm test -- src/telegram.test.ts
cd api && npm test -- src/routes/telegram.test.ts
cd api && npm test -- src/telegram-notifier.test.ts
```

Run all Phase 4 tests:

```bash
cd api && npm test
```

### Key contracts

The `TelegramTerminalJob` interface shapes all notification messages:

```typescript
interface TelegramTerminalJob {
  job_id: string
  status: 'approved' | 'low_match' | 'error'
  qa_score: string | number | null
  company_name: string | null
  role_title: string | null
  active_resume_id: string | null
  gaps?: Array<{ category?: string; detail?: string; severity?: string }> | null
}
```

### Security notes

- The bot token is never included in error responses or logs.
- All dynamic message content is MarkdownV2-escaped to prevent injection.
- Stack traces never appear in user-visible error messages.
- The notification recipient comes only from the persisted profile — never from incoming webhook data.
- The webhook uses its own authentication mechanism (`X-Telegram-Bot-Api-Secret-Token`) and is mounted outside the API-key middleware.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | For bot features | Bot token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | For webhook | Shared secret for webhook auth |

## Limitations (Phase 4 scope)

- Messages are text-only with MarkdownV2 formatting. No inline keyboards or rich UI.
- `/start` is the only command. No `/status` or other conversational commands.
- Chat IDs must be configured manually via `PATCH /profile`. No automatic capture or confirmation flow.
- Notifications use API-relative paths (`/jobs/:id/resume/:version_id`), not absolute URLs.
- No notification retry queue. A failed send attempt is silently dropped.
- No durable notification audit table. Sends are logged as typed testable results.
