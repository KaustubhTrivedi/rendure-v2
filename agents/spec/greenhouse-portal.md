# Greenhouse Portal Agent

## Purpose

Submit an approved tailored resume to a Greenhouse-hosted job through the public
Greenhouse Board API. The agent is ephemeral: it runs once for one `job_id`,
writes the submission result to the database, and terminates.

## Trigger

The Orchestrator may spawn this agent only after the Confirmation Agent has
verified an approved resume and the user explicitly opted into automatic
application submission.

## Pre-conditions

- `jobs.status = 'approved'`.
- `jobs.active_resume_id` points to the approved `resume_versions.version_id`.
- `jobs.ats_board_token` and `jobs.ats_posting_id` identify a Greenhouse posting.
- `resume_versions.latex_source` contains the durable RenderCV YAML source.
- `user_profile` row `id = 1` contains at least `full_name` and `email`.
- `allowed_transitions` contains `approved -> submitting`,
  `submitting -> submitted`, and `submitting -> submission_failed`.

## Steps

1. Read the job, active resume version, and user profile from the database.
2. Validate and set `jobs.status` from `approved` to `submitting`.
3. Render `resume_versions.latex_source` to PDF bytes with
   `render_resume_to_pdf(yaml_content=..., tmp_dir=None)`.
4. Fetch the Greenhouse Board API job endpoint:
   `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}`.
5. For each question in the `questions` array, read the first field name and
   answer the label through `AnswerEngine.lookup(question, resume_content, jd_text)`.
6. POST multipart form data to the same Greenhouse Board API endpoint with:
   `first_name`, `last_name`, `email`, `phone`, answered question fields, and
   `resume` as `("resume.pdf", pdf_bytes, "application/pdf")`.
7. On HTTP 5xx from the POST, wait five seconds and retry once. Other HTTP
   errors fail immediately.
8. Parse the response body. A missing top-level candidate `id` is a Greenhouse
   silent-accept failure and must be treated as a failed submission.
9. On success, use `response["application"]["id"]` as `ats_application_id` when
   present, otherwise fall back to the candidate `id`.

## DB Writes

- `jobs.status` is updated through validated transitions only.
- `application_submissions` receives one row for each terminal outcome:
  `status = 'submitted'` on success, `status = 'failed'` on render, HTTP, or
  silent-accept failure.
- `pipeline_events` receives an `agent_complete` row on success and an
  `agent_error` row on failure.
- All writes use parameterized `%s` placeholders.
- Error details written to the database are capped to 500 characters.

## Status Transitions

- `approved -> submitting` before any POST attempt.
- `submitting -> submitted` after a valid Greenhouse response with candidate id.
- `submitting -> submission_failed` after render failure, HTTP failure, or
  silent-accept failure.

## Error Handling

The agent raises `AgentError` for unrecoverable failures. It must not retry LLM
or answer-generation failures locally; model fallback belongs to the
Orchestrator. RenderCV `EnvironmentError` is converted to `AgentError` after
writing failed status, submission, and event rows.

Temporary PDF paths returned by the render boundary are deleted in a `finally`
block regardless of success or failure. The durable resume record remains
`resume_versions.latex_source`.

## Model

Default model: `google/gemini-3.1-flash-lite`.

The model is passed to `AnswerEngine` for LLM fallback answers when no
`answers.yaml` stock answer matches a Greenhouse screening question.
