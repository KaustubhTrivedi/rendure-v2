# Ashby Portal Agent

## Purpose

Submit an approved tailored resume to an Ashby-hosted job through Ashby's public
`applicationForm.submit` endpoint when automatic application submission is explicitly
enabled upstream.

The agent is ephemeral. It is spawned by the Orchestrator or portal router, writes all
durable state to PostgreSQL, and terminates.

## Trigger

Run only after:

- `jobs.status = 'approved'`
- `jobs.active_resume_id` points at the approved `resume_versions` row
- the user opted in to automatic submission for this job
- ATS detection identified `ats_type = 'ashby'`

## Ashby API Notes

Endpoint:

```text
POST https://api.ashbyhq.com/applicationForm.submit
```

Ashby returns an RPC-style JSON body. HTTP status is not sufficient for application
flow control. A `200 OK` response with `"success": false` is a failed submission.
The agent must check `response_json.get("success") is True` before treating the
submission as accepted.

Ashby can return required-field failures as `200 OK` with an `errors` array. These
errors are written to `application_submissions.error_detail` and surfaced through
`AgentError`.

The v1 implementation uploads the resume as multipart form data. Known unknown:
Ashby's public docs do not conclusively confirm whether the file field is always named
`_systemfield_resume`. This agent uses `_systemfield_resume`, the commonly documented
default, until a live Ashby test submission proves a portal-specific override is
required.

## Pre-conditions

The agent reads:

- `jobs.ats_board_token` as the Ashby organization hosted jobs page name
- `jobs.ats_posting_id` as the Ashby job posting id
- `jobs.jd_text`
- `jobs.active_resume_id`
- `resume_versions.latex_source` as the RenderCV YAML source
- `user_profile` row `id = 1` for applicant identity fields

Required values:

- `ats_board_token`
- `ats_posting_id`
- `active_resume_id`
- `latex_source`
- `user_profile.full_name`
- `user_profile.email`

## Steps

1. Read the approved job, active resume version, and applicant profile from the DB.
2. Validate `approved -> submitting` in `allowed_transitions`.
3. Set `jobs.status = 'submitting'`.
4. Render the approved resume with `render_resume_to_pdf(yaml_content=latex_source)`.
5. Build multipart fields:
   - `jobPostingId`
   - `organizationHostedJobsPageName`
   - `firstName`
   - `lastName`
   - `email`
   - `phoneNumber`
   - `location`
   - `_systemfield_resume`
   - optional `linkedInUrl`, `githubUrl`, `websiteUrl`, `salaryExpectation`
6. POST to `ASHBY_SUBMIT_URL` with `timeout=30`.
7. Retry once after five seconds for HTTP 5xx responses.
8. Parse JSON and require `response_json.get("success") is True`.
9. On success, write `application_submissions(status='submitted', ats_type='ashby')`,
   set `jobs.status = 'submitted'`, write a `pipeline_events` completion row, and
   return a submitted payload.
10. Delete any temporary PDF path returned by the renderer in all exit paths.

## DB Writes

Success:

- `jobs.status: submitting -> submitted`
- `application_submissions` row:
  - `ats_type = 'ashby'`
  - `status = 'submitted'`
  - `ats_application_id = response.applicationId || response.id || ''`
- `pipeline_events.event_type = 'agent_complete'`

Failure after submission begins:

- `jobs.status: submitting -> submission_failed`
- `application_submissions.status = 'failed'`
- `application_submissions.error_detail` contains a concise failure reason
- `pipeline_events.event_type = 'agent_error'`

## Status Transitions

All status updates must be validated against `allowed_transitions`:

- `approved -> submitting`
- `submitting -> submitted`
- `submitting -> submission_failed`

Do not write trigger-owned columns such as `jobs.qa_score` or
`jobs.iteration_count`.

## Error Handling

RenderCV environment failures set `submission_failed`, write a failed submission row,
write an `agent_error` event, and raise `AgentError`.

Ashby `success:false` responses set `submission_failed`, write up to the first five
errors into `error_detail`, write an `agent_error` event, and raise `AgentError`.
Missing `errors` is handled with the default message
`Ashby rejected submission - success:false`; it must not raise `KeyError`.

HTTP 5xx responses retry once with a five-second backoff. Other HTTP failures are not
retried and are converted to `AgentError` after recording the failed submission.

## Model

Default model id:

```text
google/gemini-3.1-flash-lite
```

The Ashby portal agent does not currently call the LLM directly, but accepts `model`
for consistent pipeline event metadata and future screening-question support.
