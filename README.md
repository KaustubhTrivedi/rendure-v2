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

## Required Keys

- `OpenRouter` is required for resume parsing and tailoring.
- `Jina` is optional and is only used when configured.

## Notes

- Existing legacy auth-related database migrations are still present for compatibility with older local data, but the runtime no longer uses Clerk.
- The worker now loads model keys from the saved local profile for each job run.
