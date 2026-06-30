# Portal Router Agent

## Purpose

The Portal Router is the single dispatch point for automatic application submission.
It runs only after the Confirmation Agent succeeds and only when the Orchestrator was
started with explicit `auto_apply=True`.

## Trigger

The Orchestrator calls `portal_router.run(job_id=...)` after resume confirmation when
the user passed `--auto-apply` or an equivalent API opt-in. The default path must never
spawn this agent.

## Steps

1. Read `jobs.job_url` for the provided `job_id`.
2. Call `utils.ats_detect.detect_ats(job_url)`.
3. Persist `ats_type`, `ats_board_token`, and `ats_posting_id` to the `jobs` row.
4. Dispatch to the portal agent for supported ATS types.
5. Return the portal agent result unchanged.

## Dispatch Table

| `ats_type` | Agent |
| --- | --- |
| `greenhouse` | `agents.greenhouse_portal.run` |
| `lever` | `agents.lever_portal.run` |
| `ashby` | `agents.ashby_portal.run` |

## Unsupported ATS Handling

If detection returns `unknown` or any unsupported value:

- Set `jobs.status = 'submission_failed'`.
- Insert a `pipeline_events` row with a human-readable reason.
- Truncate the URL in event detail to 200 characters.
- Raise `AgentError`.
- Do not call any portal agent.

## DB Writes

All SQL must use parameterized queries. The router writes only ATS detection fields,
`submission_failed` status for router-level failures, and `pipeline_events` audit
entries.

## Model

The router is not an LLM-heavy agent. Default model:
`google/gemini-3.1-flash-lite`.
