# Rendure

Open-source, self-hosted resume tailoring. The app no longer depends on third-party auth.

## How It Works

- The web app provisions a single local profile on first load.
- Users complete onboarding with their resume data and their own `OpenRouter` API key.
- `Jina` remains optional for scraping job pages more reliably.
- Job runs are still stored per profile, but the default open-source flow uses one local profile instead of sign-in.

## Local Setup

1. Create `.env` with your database and Redis settings.
2. Start the stack with `docker compose up`.
3. Open `http://localhost:5173`.
4. Finish onboarding and paste your `OpenRouter` API key into the profile form before importing a resume or submitting jobs.

## Production Docker Compose

The production stack assumes the host only has Docker with the Compose plugin.

```bash
cp .env.production.example .env
# edit .env and replace every changeme value
docker compose up -d --build
```

The stack starts Postgres, runs SQL migrations from `database/`, starts the API, and
serves the frontend on `${HTTP_PORT:-80}`. Postgres is private to the Docker network.

Run an agent job manually with:

```bash
docker compose --profile agents run --rm agents "https://jobs.example.com/posting/12345"
```

## Required Keys

- `OpenRouter` is required for resume parsing and tailoring.
- `Jina` is optional and is only used when configured.

## Resume Retrieval API

Resume versions are available through the centralized API:

- `GET /jobs/:id/resumes`
- `GET /jobs/:id/resume/:version_id`
- `GET /jobs/:id/resume/:version_id/pdf`

All resume retrieval endpoints require `X-API-Key`. PDF downloads require the host
`rendercv` CLI; repeated downloads are cached under `api/.cache/resumes/` by default.
Set `RESUME_PDF_CACHE_DIR`, `RESUME_PDF_RENDER_CONCURRENCY`, and
`RESUME_PDF_RENDER_TIMEOUT_MS` to tune the cache path and render behavior.

## Telegram Bot Integration

The server sends Telegram notifications when a pipeline run reaches a terminal state (approved, low_match, or error).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes (for bot features) | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_WEBHOOK_SECRET` | Yes (for webhook) | Arbitrary secret string; used to authenticate incoming webhook requests |

If `TELEGRAM_BOT_TOKEN` is not set, the Telegram terminal notifier starts as a no-op without crashing. All bot-related routes return 503.

### Webhook Setup

Set the Telegram bot webhook to your server's `/telegram` endpoint:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-server.com/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

The server validates every incoming webhook request using the `X-Telegram-Bot-Api-Secret-Token` header. Requests without a matching secret token receive a 401 response.

### Webhook Endpoint

**`POST /telegram`**

This endpoint does **not** require `X-API-Key`. It authenticates via the Telegram secret token header instead. Users send a job posting URL in a Telegram message, and the server submits it to the pipeline.

### Terminal Notifications

When a pipeline run reaches a terminal state, the server sends a notification to the configured Telegram chat. To enable notifications:

1. Set `notify_telegram_chat_id` via `PATCH /profile` (set to the chat ID from your Telegram bot interaction).
2. Set `notify_telegram_chat_id` to `null` (or omit it) to disable Telegram notifications per-profile.

The user_profile column `notify_telegram_chat_id` controls the recipient. It is never inferred from incoming webhook messages — only the persisted profile value is used for outbound notifications.

Notification types:
- **approved** — Includes QA score, company/role, and API paths for resume retrieval (`/jobs/:id/resume/:version_id` and `/jobs/:id/resume/:version_id/pdf`).
- **low_match** — Includes QA score and key high-severity QA gaps.
- **error** — Safe plain message with job ID, no stack traces.

## Notes

- Existing legacy auth-related database migrations are still present for compatibility with older local data, but the runtime no longer uses Clerk.
- The worker now loads model keys from the saved local profile for each job run.
