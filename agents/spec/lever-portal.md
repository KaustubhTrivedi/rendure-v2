# Lever Portal Agent

## Purpose

`agents/lever_portal.py` submits an approved, explicitly opted-in application to
Lever's public Postings API. It is an ephemeral portal agent: the Orchestrator
spawns it after Confirmation only when auto-apply is enabled, it writes its DB
outcome, then it terminates.

## Trigger

The agent runs only for jobs detected as Lever postings and only after:

- `jobs.status = 'approved'`
- `jobs.active_resume_id` references the approved resume version
- `jobs.ats_board_token` contains the Lever company token
- `jobs.ats_posting_id` contains the Lever posting id

## Pre-conditions

The agent reads:

- `jobs`: `ats_board_token`, `ats_posting_id`, `jd_text`, `active_resume_id`,
  `status`
- `resume_versions`: `latex_source` for the active resume version
- `user_profile` id `1`: `full_name`, `email`, `phone`, `location`,
  `linkedin_url`, `github_url`, `portfolio_url`, `salary_expectation`

`full_name`, `email`, `active_resume_id`, `ats_board_token`, and
`ats_posting_id` are required.

## API Details

Lever endpoint:

```text
POST https://api.lever.co/v0/postings/{company}/{posting_id}/apply
```

The request is multipart form data. Lever uses `name` and `email`; it does not
require a first-name/last-name split.

Fixed fields:

- `name`
- `email`
- `phone`
- `location`
- `urls[LinkedIn]`
- `urls[GitHub]`
- `urls[Portfolio]`
- `comments`
- `resume` PDF file tuple

The successful response contains `applicationId`, which is persisted as
`application_submissions.ats_application_id`.

## Steps

1. Read the approved job, active resume version, and user profile.
2. Validate the `approved -> submitting` transition and set `jobs.status`.
3. Render `resume_versions.latex_source` with `render_resume_to_pdf`.
4. Build the Lever multipart payload.
5. POST to the Lever apply endpoint.
6. On success, insert `application_submissions` with `ats_type='lever'`,
   `status='submitted'`, and the response `applicationId`.
7. Set `jobs.status = 'submitted'`.
8. Write `pipeline_events` for status changes and final outcome.
9. Delete any temp PDF path in a `finally` block.

## DB Writes

All SQL uses parameterized values for external data.

- `jobs.status`: `approved -> submitting -> submitted`
- `application_submissions`: one row per submission outcome
- `pipeline_events`: status changes, success, and failures

Failure paths write `application_submissions.status = 'failed'` when the active
resume version is known, set `jobs.status = 'submission_failed'`, and write an
`agent_error` event. Lever response/error text is truncated to 500 characters
before persistence.

## Status Transitions

The agent validates transitions against `allowed_transitions` before normal
status writes:

- `approved -> submitting`
- `submitting -> submitted`

Failure paths set `submission_failed` and log the error outcome.

## Error Handling

The agent raises `AgentError` for pre-condition failures, render failures,
HTTP failures, malformed response handling, and DB errors. Sub-agents do not
communicate with the user directly; the Orchestrator owns user-facing messaging.

## 429 Retry Policy

Lever `429` responses are retried exactly once:

- If `Retry-After` is present and parseable, sleep for that value.
- If `Retry-After` is absent or invalid, sleep for `60` seconds.
- Sleep is capped at `120` seconds to prevent unbounded API-controlled delay.

HTTP `400` is never retried. HTTP `5xx` responses use one transient retry after
`5` seconds. Other HTTP errors fail the agent.

## Model

`MODEL = "google/gemini-3.1-flash-lite"`

The current Lever implementation does not need an LLM call because Lever form
fields for this phase are fixed.
