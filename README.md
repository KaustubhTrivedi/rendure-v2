# Rendure

Rendure is a self-hosted resume tailoring service. You give it a job posting URL, it scrapes the posting, generates a tailored resume, runs a QA pass, and stores every run in Postgres for review.

Rendure does not submit applications. It prepares resume versions and QA notes so you can review the output and apply yourself.

## What You Get

- Web dashboard for submitting jobs and tracking pipeline progress.
- Single-user local profile with encrypted OpenRouter API key storage.
- Python agent pipeline for job scraping, resume tailoring, QA, and confirmation.
- Postgres-backed audit trail for jobs, resume versions, QA reviews, and pipeline events.
- Live job-detail updates through server-sent events.
- RenderCV PDF downloads for approved resume versions.
- Optional Telegram webhook submission and completion notifications.

## Quick Start With Docker

Docker Compose is the recommended way to run Rendure.

```bash
cp .env.production.example .env
# Edit .env and replace every placeholder secret.
docker compose up -d --build
```

Open `http://localhost` unless you changed `HTTP_PORT`.

On first load, complete onboarding with your name and OpenRouter API key. The key is stored in the local Postgres database encrypted with `PROFILE_ENCRYPTION_KEY`.

For live pipeline runs, also set `OPENROUTER_API_KEY` in `.env`. The current Python agents read this environment variable directly.

## Development Setup

Use the dev Compose file when working locally:

```bash
cp .env.dev.example .env.dev
docker compose -f docker-compose.dev.yml --env-file .env.dev up --build
```

Dev ports:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3002`
- Postgres: `localhost:5432`

Useful local commands:

```bash
uv sync
uv run python run_agents.py "https://jobs.example.com/posting/12345" --verbose

cd api && npm run test
cd frontend && npm run typecheck
```

## Required Configuration

Core settings:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string for API and agents |
| `RENDURE_API_KEY` | Yes | Shared API key for `/jobs/*` and `/profile/*` |
| `PROFILE_ENCRYPTION_KEY` | Yes | 64-character hex key for encrypting profile secrets |
| `OPENROUTER_API_KEY` | Yes for pipeline | API key used by Python agents |
| `OPENROUTER_MODEL` | No | Global default model |
| `JINA_API_KEY` | No | Optional higher-limit Jina Reader key |

Pipeline tuning:

| Variable | Default | Purpose |
| --- | --- | --- |
| `QA_PASS_THRESHOLD` | `0.92` | Minimum QA score to approve |
| `MAX_TAILORING_ITERATIONS` | `4` | Max tailor and QA loops |
| `AGENT_TIMEOUT_SECONDS` | `300` | Agent wait timeout |
| `POLL_INTERVAL_SECONDS` | `5` | DB polling interval |

Optional per-agent model overrides:

```dotenv
MODEL_JOB_SCOUT=
MODEL_RESUME_TAILOR=
MODEL_QUALITY_ANALYST=
MODEL_CONFIRMATION=
MODEL_ORCHESTRATOR=
MODEL_FALLBACK=
```

PDF rendering:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESUME_PDF_CACHE_DIR` | `api/.cache/resumes` locally | Cached rendered PDFs |
| `RESUME_PDF_RENDER_CONCURRENCY` | `2` | Concurrent RenderCV jobs |
| `RESUME_PDF_RENDER_TIMEOUT_MS` | `30000` | Render timeout |

## How The Pipeline Works

The main CLI entry point is:

```bash
uv run python run_agents.py "https://jobs.example.com/posting/12345"
```

The web API uses the same pipeline. `POST /jobs` inserts a `jobs` row, returns a `job_id`, then starts:

```bash
uv run python run_agents.py "<url>" --job-id "<job_id>"
```

Agent flow:

1. `orchestrator` validates the URL, creates or reuses the job row, and coordinates all agents.
2. `job_scout` scrapes the posting through Jina Reader and writes structured job data.
3. `resume_tailor` reads `resume/resume.md` on the first pass, then writes generated content to `resume_versions`.
4. `quality_analyst` scores the generated version and writes an immutable `qa_reviews` row.
5. If QA fails and iterations remain, the orchestrator loops back to tailoring.
6. If QA passes, `confirmation` verifies the approved record and the API exposes the resume.

Generated resume versions are stored in the database. The current renderer expects RenderCV YAML content even though the legacy column name is `latex_source`.

## Web App

Frontend routes:

- `/onboarding` creates the local profile and stores the OpenRouter key.
- `/` lists jobs, submits URLs, and shows status summaries.
- `/jobs/:id` shows pipeline stages, live event feed, QA summary, and resume links.
- `/jobs/:id/resume/:vid` previews a stored resume version.
- `/jobs/:id/qa/:rid` shows QA details and gap feedback.
- `/settings` edits profile preferences, model choice, QA threshold, max iterations, and Telegram chat ID.

Some UI controls are currently placeholders, including dashboard search, some resume toolbar actions, QA regenerate/fix actions, and settings test notification/reset buttons.

## API

Health:

```bash
curl http://localhost:3002/
```

Protected routes require `X-API-Key: $RENDURE_API_KEY`.

Common endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/jobs` | Submit `{ "url": "https://..." }` |
| `GET` | `/jobs` | List jobs |
| `GET` | `/jobs/:id` | Full job detail |
| `GET` | `/jobs/:id/status` | Compact status |
| `GET` | `/jobs/:id/events` | SSE pipeline events |
| `GET` | `/jobs/:id/qa` | QA review history |
| `GET` | `/jobs/:id/resumes` | Resume version list |
| `GET` | `/jobs/:id/resume/:version_id` | Raw stored resume source |
| `GET` | `/jobs/:id/resume/:version_id/pdf` | Rendered PDF |
| `POST` | `/profile` | Create local profile |
| `PATCH` | `/profile` | Update profile preferences |
| `PUT` | `/profile/api-key` | Store encrypted OpenRouter key |
| `GET` | `/profile/models` | List OpenRouter models using stored key |

Example:

```bash
curl -X POST http://localhost:3002/jobs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $RENDURE_API_KEY" \
  -d '{"url":"https://jobs.example.com/posting/12345"}'
```

## Database And Migrations

The schema lives in `database/schema.sql`. Compose runs `scripts/migrate.sh`, which applies `schema.sql` first, then sorted numbered migrations under `database/`, recording applied filenames in `schema_migrations`.

Important tables:

- `jobs`: central job state and extracted posting details.
- `job_skills`: normalized required and nice-to-have skills.
- `resume_versions`: generated resume versions.
- `qa_reviews`: immutable QA evaluations.
- `pipeline_events`: audit log and live event source.
- `user_profile`: single local profile and encrypted provider key.
- `allowed_transitions`: valid pipeline status transitions.

Triggers keep `jobs.iteration_count` and `jobs.qa_score` synced from generated versions and QA reviews.

## PDF Rendering

The API renders PDFs on demand:

```text
GET /jobs/:id/resume/:version_id/pdf
```

Rendering uses the `rendercv` CLI and caches PDFs by resume version ID. In Docker, the API image includes RenderCV and stores cached PDFs in the `resume_pdf_cache` volume.

The CLI orchestrator also attempts a Docker-based RenderCV build after approval and exports files under `output/<company>_<role>/`. If rendering fails, the generated source remains in the database.

## Telegram

Telegram is optional.

Set these environment variables:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

Set the webhook:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://your-domain.example/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Then set your chat ID in the app settings or through:

```bash
curl -X PATCH http://localhost:3002/profile \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $RENDURE_API_KEY" \
  -d '{"notify_telegram_chat_id":"123456789"}'
```

Inbound Telegram messages can submit a single job URL. Outbound notifications are sent when a job reaches `approved`, `low_match`, or `error`.

## Production Notes

- Production Compose exposes only the frontend on `${HTTP_PORT:-80}`. Postgres stays private.
- Nginx proxies `/api/` to the API and injects `X-API-Key`.
- `VITE_API_KEY` is embedded in the browser bundle, so this is a self-hosted/local trust model, not strong public multi-tenant authentication.
- Prompt traces and pipeline events can include job description and resume content. Treat the database as sensitive.
- Duplicate job URLs return the existing job instead of starting a new run.
- Some job sites block scraping or URL validation. Those runs end in `error` with details in `pipeline_events`.

## Repository Map

```text
agents/                 Python pipeline agents
api/                    Hono TypeScript API
frontend/               React Router frontend
database/               Base schema and migrations
resume/resume.md        Base resume source used for first tailoring pass
scripts/migrate.sh      Idempotent migration runner
docker-compose.yml      Production stack
docker-compose.dev.yml  Development stack
```
