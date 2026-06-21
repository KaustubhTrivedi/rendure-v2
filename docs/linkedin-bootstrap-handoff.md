# LinkedIn Post Handoff: One-Command Rendure Bootstrap

## Objective

Create a LinkedIn post announcing a usability improvement to Rendure: users can now bootstrap the full self-hosted resume tailoring system with one terminal command, then open the local web app and start onboarding.

The post should be useful, technical, and credible. It should explain why the change matters without sounding like a product launch press release.

## Project Context

Rendure is a self-hosted resume tailoring service. A user provides a job posting URL, and the system:

- Scrapes the job posting.
- Tailors a resume version.
- Runs an automated QA pass against the job description.
- Stores jobs, resume versions, QA reviews, and pipeline events in Postgres.
- Lets the user review everything in a web dashboard.

Important positioning:

- Rendure does not submit job applications.
- The user reviews and applies themselves.
- It is self-hosted.
- It is designed around local ownership of data, keys, and workflow.

## What Changed

We added a one-command bootstrap flow.

The command:

```bash
curl -fsSL https://raw.githubusercontent.com/KaustubhTrivedi/rendure-v2/main/scripts/bootstrap.sh | bash
```

What it does:

- Clones or updates the Rendure repo into `./rendure`.
- Creates a `.env` file if one does not already exist.
- Generates local secrets for:
  - Postgres password
  - Rendure API key
  - profile encryption key
- Sets the frontend port to `8080` by default.
- Runs `docker compose up -d --build`.
- Prints the local URL: `http://localhost:8080`.

The user then opens the local web app and completes onboarding with their profile and API key.

## Files Changed

Implementation:

- `scripts/bootstrap.sh`
  - New executable bootstrap script.
  - Supports `--dry-run` for testable behavior.
  - Supports env overrides:
    - `RENDURE_APP_DIR`
    - `HTTP_PORT`
    - `RENDURE_REPO_URL`

Docs:

- `README.md`
  - Added the one-command Quick Start.
  - Added custom checkout directory / port example.

Landing page:

- `frontend/app/routes/landing.tsx`
  - Updated final CTA command from `docker compose up -d --build` to the full bootstrap command.
  - Updated copy button behavior to copy the full bootstrap command.
  - Updated FAQ wording.
  - Corrected GitHub links to point to the actual repo.

- `landing/index.html`
  - Same CTA, copy handler, FAQ, and GitHub link updates for the static landing page.

Tests:

- `tests/test_bootstrap.py`
  - Verifies dry-run `.env` generation.
  - Verifies README includes the one-command bootstrap.
  - Verifies both landing pages include the bootstrap command.

## Verification Performed

Tests passed:

```bash
uv run pytest tests/
```

Result:

```text
31 passed
```

Frontend typecheck passed:

```bash
npm run typecheck
```

Browser verification:

- Opened local landing page at `http://127.0.0.1:5173/landing`.
- Confirmed the new bootstrap command is visible.
- Confirmed the old Docker-only command is no longer visible in the rendered CTA.

Git:

- Branch: `feat/landing-page`
- Latest pushed commit after merging `origin/main`: `4ad329f`
- Remote: `origin/feat/landing-page`

## Suggested LinkedIn Narrative

Core message:

> I removed setup friction from Rendure. Instead of telling users to clone the repo, copy env templates, generate secrets, edit config, and then run Docker Compose, the landing page now gives them one terminal command that bootstraps the whole local system.

Why it matters:

- Self-hosted software often loses people before they reach the product.
- A project can be technically solid but still hard to try.
- Setup is part of the user experience.
- The first successful interaction should be the app running, not a long checklist.

Good angle:

> This was not a huge feature. It was a packaging and onboarding improvement. But for self-hosted tools, those improvements matter disproportionately.

## Suggested Post Structure

1. Start with a direct hook:
   - "I just changed Rendure from a multi-step setup to a one-command bootstrap."
   - Or: "Self-hosted tools often fail at the first mile: setup."

2. Explain the before state:
   - Users had to clone the repo, create `.env`, replace secrets, build containers, and find the right local URL.

3. Explain the after state:
   - One command clones/updates, generates local secrets, starts Docker Compose, and prints the local URL.

4. Tie it back to product philosophy:
   - Rendure is meant to be self-hosted and user-owned.
   - The bootstrap command supports that by making local ownership easier, not by hiding it behind a hosted service.

5. Mention technical rigor:
   - Added tests for dry-run env generation, README command presence, and landing page command presence.
   - Ran Python tests and frontend typecheck.
   - Verified the rendered landing page in the browser.

6. End with a practical note:
   - Users can now paste the command, open the web app, complete onboarding, and start tailoring resumes from job URLs.

## Tone Guidance

Use:

- Clear
- Builder-oriented
- Practical
- Reflective
- Slightly opinionated about self-hosted UX

Avoid:

- Overclaiming
- "Revolutionary"
- "Game changer"
- "10x"
- Sounding like a SaaS launch
- Saying the system applies to jobs automatically

## Important Accuracy Guardrails

Do not say:

- Rendure submits job applications.
- No API key is needed.
- No Docker is needed.
- It works without configuration in all environments.
- It is production-hosted or cloud-native.

Do say:

- The command bootstraps a local self-hosted stack.
- Users still complete onboarding and add their API key.
- Docker is required.
- The system prepares resume versions and QA notes for user review.
- The user remains in control of applications.

## Possible LinkedIn Post Draft

I just made Rendure much easier to try.

Before this change, running the self-hosted stack meant cloning the repo, creating an `.env`, generating local secrets, building the containers, starting Docker Compose, and then finding the right local URL.

Now the landing page gives you one command:

```bash
curl -fsSL https://raw.githubusercontent.com/KaustubhTrivedi/rendure-v2/main/scripts/bootstrap.sh | bash
```

It clones or updates the repo, creates a local `.env` if needed, generates the local secrets, starts the full Docker Compose stack, and prints the URL for the web app.

This is a small feature, but an important one.

For self-hosted software, setup is part of the product. If people have to fight the install path before they can understand the value, the product has already made a bad first impression.

Rendure is built around local ownership: your job runs, resume versions, QA reviews, API keys, and pipeline events stay in your own local stack. The goal is not to hide that behind a hosted dashboard. The goal is to make ownership easier to start with.

I also updated the landing page CTA, the README, and added regression tests around the bootstrap flow so the command does not drift out of sync.

Verified with:

- Python test suite: `31 passed`
- Frontend typecheck
- Browser check of the rendered landing page

The new flow is simple:

Paste one command. Open the local web app. Complete onboarding. Start tailoring resumes from job URLs.

Rendure still does not submit applications for you. It prepares the resume version and QA notes so you can review and apply yourself.

## Optional Shorter Version

Self-hosted tools often fail at the first mile: setup.

I just changed Rendure from a manual Docker setup flow to a one-command bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/KaustubhTrivedi/rendure-v2/main/scripts/bootstrap.sh | bash
```

It clones or updates the repo, creates `.env`, generates local secrets, starts Docker Compose, and prints the local web app URL.

Small feature, big UX impact.

For self-hosted software, onboarding is not separate from the product. The install path is the first user experience.

Rendure remains local-first: your resume versions, QA reviews, job runs, and keys stay in your own stack. The new bootstrap just makes that ownership easier to start.

Verified with tests, frontend typecheck, and a rendered browser check.
