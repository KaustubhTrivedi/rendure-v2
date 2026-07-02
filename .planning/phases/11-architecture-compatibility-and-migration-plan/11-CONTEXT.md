# Phase 11: Architecture, Compatibility, and Migration Plan - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase locks the compatibility, migration, audit, privacy, and guardrail-test contract for v4.1 before Career Vault, application tracking, recruiter CRM, discovery, and match scoring add new domains. It does not build those later capabilities. It makes the existing URL-to-tailored-resume path remain load-bearing and establishes the boundaries downstream phases must preserve.

</domain>

<decisions>
## Implementation Decisions

### Backward-Compatible API Contract
- **D-01:** Existing job URL submission remains supported without any Vault setup. A user must still be able to submit a URL and complete Job Scout, Resume Tailor, Quality Analyst, and Confirmation through the existing pipeline path.
- **D-02:** Compatibility means additive-only changes for existing clients. Existing route paths, HTTP semantics, response field meanings, pipeline statuses, SSE event names, resume Markdown/PDF retrieval behavior, job detail responses, job status responses, and QA report responses must remain stable.
- **D-03:** New response fields are allowed only when old clients can safely ignore them. Existing fields must not be renamed, removed, narrowed, or repurposed as part of this phase.

### Migration and Status Separation
- **D-04:** Phase 11 should enforce strict separation between pipeline job state and application workflow state. Application statuses must not reuse or mutate `jobs.status`.
- **D-05:** Database changes in this phase must be additive. Plans must not write directly to trigger-owned `jobs.qa_score` or `jobs.iteration_count`; those remain synchronized only by the existing PostgreSQL triggers.
- **D-06:** If this phase introduces schema boundaries for later application or Vault domains, those boundaries must be compatibility scaffolding only. Later phases may fill them in, but Phase 11 should avoid shipping half-built user-facing workflows.

### Audit and Redaction Policy
- **D-07:** `pipeline_events` remains a pipeline lifecycle/debugging audit log. Application activity, recruiter follow-ups, reminders, and future user workflow actions belong in a separate application timeline or equivalent non-pipeline audit surface.
- **D-08:** Pipeline audit rows, app timeline rows, logs, and LLM metadata must not store full private Vault evidence, recruiter/contact details, raw prompts, private notes, or full generated content unless that content is explicitly required for a user-visible artifact.
- **D-09:** Preferred audit metadata shape is identifiers, counts, bounded summaries, hashes, statuses, and redacted snippets. Store enough to debug and explain system behavior without turning audit logs into a private-data sink.

### Guardrail Test Boundary
- **D-10:** Phase 11 must produce blocking guardrail tests for no-Vault tailoring fallback, approval-gated evidence writes, source-required missing evidence, application status separation, no auto-apply, and no automatic email sending.
- **D-11:** These guardrail tests are compatibility gates for later v4.1 phases. Later phases should not be considered safe to execute if they break these boundaries.
- **D-12:** Tests should cover both backend/API behavior and pipeline-agent boundaries where relevant. The project TDD rule applies: production code changes must be preceded by a failing test and completed with the relevant test command passing.

### the agent's Discretion
- Planner may choose the exact split of PLAN.md files, as long as each plan preserves the locked decisions above and covers COMPAT-01 through COMPAT-06 plus GUARD-06.
- Planner may choose whether compatibility scaffolding is best represented as tests, helper functions, schemas, route adapters, or documentation, provided it does not introduce user-facing half-features from later phases.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Product Constraints
- `.planning/ROADMAP.md` - Phase 11 goal, dependency, requirements, and success criteria.
- `.planning/REQUIREMENTS.md` - COMPAT-01 through COMPAT-06 and GUARD-06 requirement definitions.
- `.planning/PROJECT.md` - Project-level compatibility, evidence approval, no auto-apply, and no email-send constraints.
- `.planning/STATE.md` - Current milestone state and v4.1 compatibility decisions.
- `AGENTS.md` - Project workflow, TDD, database, pipeline, and safety constraints.

### Existing Pipeline and API Contract
- `api/src/routes/jobs.ts` - Existing job submission, list/detail/status, SSE, resume, and QA route behavior.
- `api/src/sse.ts` - Stable pipeline SSE event payload and terminal-status handling.
- `api/src/pg-listener.ts` - Pipeline event LISTEN/NOTIFY integration.
- `api/src/job-submission.ts` - Shared URL submission and pipeline spawn boundary.
- `agents/orchestrator.py` - Existing URL/JD pipeline orchestration, model fallback, status polling, and user-facing pipeline behavior.
- `agents/job_scout.py` - Existing Job Scout DB and status transition behavior.
- `agents/resume_tailor.py` - Existing tailoring behavior and resume version writes.
- `agents/quality_analyst.py` - Existing QA review, score, and pass/fail behavior.
- `agents/confirmation.py` - Existing approved-resume confirmation behavior.

### Database and Migration Boundaries
- `database/schema.sql` - Existing jobs, resume_versions, qa_reviews, pipeline_events, allowed_transitions, and trigger-owned column definitions.
- `database/003_pipeline_events_notify.sql` - Pipeline event notification behavior.
- `database/004_per_agent_models.sql` - Existing additive migration pattern.
- `database/005_profile_resume.sql` - Existing additive migration pattern.
- `database/006_llm_provider.sql` - Existing additive migration pattern.
- `database/007_discovery.sql` - Existing additive migration pattern for later-domain style.

### Test Surface
- `api/src/routes/jobs.test.ts` - Current API/SSE/resume/QA route test patterns.
- `api/src/job-submission.test.ts` - Job submission behavior tests.
- `api/src/sse.ts` and `api/src/pg-listener.test.ts` - SSE and listener behavior surface.
- `tests/test_resume_tailor.py` - Existing Python tailoring test surface.
- `tests/test_quality_analyst.py` - Existing Python QA test surface.
- `tests/test_bootstrap.py` - Existing Python test bootstrap pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `toPipelineEventPayload` in `api/src/sse.ts`: stable serialization point for SSE payload compatibility tests.
- `listenForPipelineEvents` in `api/src/pg-listener.ts`: existing LISTEN/NOTIFY boundary for live pipeline events.
- `submitJobUrl` in `api/src/job-submission.ts`: shared job submission boundary that can host no-Vault compatibility tests without duplicating route behavior.
- `_validate_transition`, `_set_job_status`, and `_spawn_with_fallback` in `agents/orchestrator.py`: existing pipeline state and model fallback enforcement points.
- PostgreSQL triggers `trg_sync_iteration_count` and `trg_sync_qa_score` in `database/schema.sql`: source of truth for trigger-owned columns.

### Established Patterns
- Hono route tests use Vitest with mocked `pool.query`, subprocess spawn, and listener boundaries.
- Python agent tests use pytest and mock outer external boundaries such as LLM calls, HTTP calls, and DB connections.
- The API and Python pipeline communicate through PostgreSQL only; no shared memory contract should be introduced.
- Pipeline state is represented by `jobs.status`; this must stay limited to pipeline lifecycle status values.
- `pipeline_events` is insert-only lifecycle/audit data and is also the SSE event source.

### Integration Points
- Existing clients depend on `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/status`, `GET /jobs/:id/events`, resume retrieval, PDF retrieval, and QA report routes.
- Later application tracker work needs a separate status/timeline model that can link to a job without mutating pipeline lifecycle state.
- Later Career Vault work needs an approved-evidence path that can be absent or unavailable without breaking base resume tailoring.

</code_context>

<specifics>
## Specific Ideas

- Prefer stricter, default-safe compatibility decisions over permissive ambiguity.
- Use additive-only route and schema evolution as the compatibility rule.
- Treat guardrail tests as blocking compatibility gates for later v4.1 phases.
- Use IDs, counts, summaries, hashes, and redacted snippets in audit metadata rather than raw private content.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 11-Architecture, Compatibility, and Migration Plan*
*Context gathered: 2026-06-23*
