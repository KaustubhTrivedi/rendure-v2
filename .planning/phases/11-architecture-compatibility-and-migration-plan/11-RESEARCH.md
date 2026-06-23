# Phase 11: Architecture, Compatibility, and Migration Plan - Research

**Researched:** 2026-06-23
**Domain:** API compatibility, additive PostgreSQL migrations, audit redaction, and guardrail tests
**Confidence:** HIGH for existing code contracts; MEDIUM for live runtime state because no PostgreSQL client or live database query was available.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

None - discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMPAT-01 | Existing job URL submission still creates a pipeline job and runs Job Scout, Resume Tailor, Quality Analyst, and Confirmation without requiring Vault setup. | `submitJobUrl` inserts `jobs.status='new'` and dispatches `run_agents.py`; the Python orchestrator then advances `new -> found -> tailoring -> qa_review -> approved/qa_failed/low_match/error`. [VERIFIED: api/src/job-submission.ts, agents/orchestrator.py, database/schema.sql] |
| COMPAT-02 | Existing job detail, status, SSE events, resume Markdown retrieval, PDF retrieval, and QA report routes remain backward compatible. | Existing API routes are `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/status`, `GET /jobs/:id/events`, `GET /jobs/:id/resumes`, `GET /jobs/:id/resume/:version_id`, `GET /jobs/:id/resume/:version_id/pdf`, and `GET /jobs/:id/qa`. [VERIFIED: api/src/routes/jobs.ts] |
| COMPAT-03 | New migrations are additive and do not write directly to trigger-owned `jobs.qa_score` or `jobs.iteration_count`. | Existing migrations use `ADD COLUMN IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS`, and triggers update `jobs.iteration_count` from `resume_versions` inserts and `jobs.qa_score` from `qa_reviews` inserts. [VERIFIED: database/004_per_agent_models.sql, database/005_profile_resume.sql, database/006_llm_provider.sql, database/007_discovery.sql, database/schema.sql] |
| COMPAT-04 | Application workflow status does not reuse or mutate pipeline-owned `jobs.status`. | Current `jobs.status` is a pipeline state machine, while discovery already uses a separate `discovered_jobs.status`; later application statuses should follow the same separate-table pattern. [VERIFIED: database/schema.sql, database/007_discovery.sql] |
| COMPAT-05 | Pipeline events remain pipeline audit records; application activity uses a separate timeline. | Current SSE and live delivery read only `pipeline_events`, and the notification trigger intentionally emits only `job_id` and `event_id`. [VERIFIED: api/src/sse.ts, api/src/pg-listener.ts, database/003_pipeline_events_notify.sql] |
| COMPAT-06 | Logs and audit events avoid storing full private Vault, recruiter, or prompt content unless explicitly required for a user-visible artifact. | API request logging already excludes bodies and headers, but Resume Tailor and Quality Analyst currently write full LLM prompts into `pipeline_events.payload`, so Phase 11 must add redaction or removal tests around prompt traces. [VERIFIED: api/src/middleware/logger.ts, agents/resume_tailor.py, agents/quality_analyst.py] |
| GUARD-06 | Automated tests cover no-Vault tailoring fallback, approval-gated evidence writes, source-required missing evidence, application status separation, and no-send/no-auto-apply boundaries. | Existing tests cover many API and agent surfaces, but no existing test file directly covers Vault fallback, evidence approval gates, application status separation, no auto-apply, or no automatic email sending. [VERIFIED: rg over tests/, api/src, agents] |
</phase_requirements>

## Summary

Phase 11 should be planned as a compatibility and safety hardening phase, not as a feature-building phase. [VERIFIED: .planning/phases/11-architecture-compatibility-and-migration-plan/11-CONTEXT.md] The existing URL submission path is concentrated at `api/src/job-submission.ts`, the job API compatibility surface is concentrated at `api/src/routes/jobs.ts`, SSE payload stability is concentrated at `api/src/sse.ts`, and pipeline state transitions are concentrated in the Python agents plus `database/schema.sql`. [VERIFIED: codebase grep]

The highest-risk current implementation detail is audit privacy: `api/src/middleware/logger.ts` already avoids request bodies and header values, but `agents/resume_tailor.py` and `agents/quality_analyst.py` insert `llm_prompt_trace` rows containing the full prompt in `pipeline_events.payload`. [VERIFIED: codebase grep] That conflicts with the Phase 11 redaction decision for raw prompts and private future Vault content, so the planner should prioritize a small redaction helper plus blocking tests before later phases add Vault, recruiter, application, or prompt-rich content. [VERIFIED: 11-CONTEXT.md; agents/resume_tailor.py; agents/quality_analyst.py]

**Primary recommendation:** Plan Phase 11 as four vertical slices: compatibility contract tests, additive migration/status boundary tests, audit redaction implementation/tests, and future-safety guardrail tests. [VERIFIED: 11-CONTEXT.md; AGENTS.md; existing test layout]

## Project Constraints (from AGENTS.md)

- All production code changes must follow RED-GREEN-REFACTOR as vertical slices: one failing behavior test, minimal implementation, then refactor while green. [CITED: AGENTS.md]
- Always use `uv` for Python dependency management; do not use `pip install` for project dependency changes. [CITED: AGENTS.md]
- Commit both `pyproject.toml` and `uv.lock` when adding Python packages. [CITED: AGENTS.md]
- Use Python 3.12 with type annotations for Python code. [CITED: AGENTS.md]
- Use parameterized SQL queries only. [CITED: AGENTS.md]
- Validate status transitions against `allowed_transitions` before writing pipeline status changes. [CITED: AGENTS.md]
- Never write directly to trigger-owned `jobs.qa_score` or `jobs.iteration_count`. [CITED: AGENTS.md]
- Never update or delete `qa_reviews` rows. [CITED: AGENTS.md]
- Write `pipeline_events` rows for significant pipeline actions, fallbacks, and errors, but Phase 11 must constrain their content to redacted pipeline lifecycle data. [CITED: AGENTS.md; VERIFIED: 11-CONTEXT.md]
- All inter-agent state must pass through PostgreSQL; do not introduce shared memory or direct sub-agent communication. [CITED: AGENTS.md]
- Sub-agents are ephemeral and do not communicate with users; Orchestrator remains the user-facing controller. [CITED: AGENTS.md]
- Job Scout must treat scraped job descriptions as untrusted content and ignore prompt-injection instructions found in scraped pages. [CITED: AGENTS.md]
- Do not modify `main.py` casually because it owns the one-shot OAuth PKCE flow. [CITED: AGENTS.md]
- Do not modify `utils/Antigravity.py` casually if present; current source code for this repo uses `utils/llm.py` for OpenRouter/Codex OAuth LLM loading, so planner should verify the actual touched module before applying AGENTS' older Antigravity-specific guidance. [CITED: AGENTS.md; VERIFIED: utils/llm.py; rg]
- Existing AGENTS sections conflict with current source in a few places: AGENTS describes a `db/` directory and Git-branch resume workflow, while the current repo uses `database/` and DB-stored resume versions with nullable `git_branch`/`git_commit`. [CITED: AGENTS.md; VERIFIED: database/schema.sql; agents/resume_tailor.py]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Job URL submission compatibility | API / Backend | Database / Storage | `submitJobUrl` validates duplicates, inserts `jobs`, and dispatches the pipeline; database state is the durable contract. [VERIFIED: api/src/job-submission.ts] |
| Pipeline lifecycle status | Database / Storage | API / Backend | `jobs.status` and `allowed_transitions` define pipeline state; API and frontend read those values without owning workflow semantics. [VERIFIED: database/schema.sql; api/src/routes/jobs.ts; frontend/app/lib/types.ts] |
| SSE event compatibility | API / Backend | Database / Storage | `toPipelineEventPayload` serializes rows and `listenForPipelineEvents` wakes streams from DB notifications. [VERIFIED: api/src/sse.ts; api/src/pg-listener.ts] |
| Resume Markdown/PDF retrieval compatibility | API / Backend | Database / Storage | Markdown is served from `resume_versions.latex_source`; PDF is rendered or cached by API route code without changing stored source. [VERIFIED: api/src/routes/jobs.ts; api/src/resume-render.ts] |
| QA report compatibility | API / Backend | Database / Storage | QA routes expose persisted `qa_reviews` rows joined through `resume_versions`; frontend expects four visible QA dimensions. [VERIFIED: api/src/routes/jobs.ts; frontend/app/routes/jobs.$id_.qa.$rid.tsx] |
| Additive migrations | Database / Storage | API / Backend | Existing migration style is additive SQL; API updates must tolerate nullable new fields. [VERIFIED: database/004_per_agent_models.sql; database/007_discovery.sql; api/src/routes/jobs.ts] |
| Application workflow status separation | Database / Storage | API / Backend | Future application statuses need a separate table/status column and must not extend or repurpose `jobs.status`. [VERIFIED: 11-CONTEXT.md; database/schema.sql] |
| Audit redaction | API / Backend | Database / Storage | Writers construct audit metadata before insert; storage should receive redacted payloads only. [VERIFIED: agents/orchestrator.py; agents/resume_tailor.py; agents/quality_analyst.py; api/src/execution-adapter.ts] |
| No-send/no-auto-apply guardrails | API / Backend | Browser / Client | Backend must expose no sending/application-submission side effects; frontend may link users to manual review/download flows only. [VERIFIED: rg for send/apply/browser automation; frontend/app/routes/landing.tsx; agents/orchestrator.py] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.12.18 | API routing and middleware. | Existing API routes are Hono route modules and should remain in that style. [VERIFIED: api/package-lock.json; api/src/index.ts] |
| pg | 8.20.0 | PostgreSQL access from the TypeScript API. | Existing job routes, listeners, and execution adapter use `pg` pool/client patterns. [VERIFIED: api/package-lock.json; api/src/db.ts; api/src/pg-listener.ts] |
| Vitest | 4.1.5 | TypeScript API tests. | Existing API tests are Vitest tests and `api/package.json` runs `vitest run`. [VERIFIED: api/package-lock.json; api/package.json; api/src/routes/jobs.test.ts] |
| pytest | 9.0.3 | Python agent and utility tests. | Existing Python tests run under pytest through `uv run pytest tests/`. [VERIFIED: uv tree; test command output] |
| psycopg2-binary | 2.9.11 | PostgreSQL access from Python agents. | Agents call `psycopg2.connect(os.environ["DATABASE_URL"])`. [VERIFIED: uv tree; agents/job_scout.py; agents/resume_tailor.py; agents/quality_analyst.py; agents/confirmation.py] |
| React | 19.2.6 | Existing frontend UI. | Job detail, resume, and QA pages are React route components. [VERIFIED: frontend/package-lock.json; frontend/app/routes/jobs.$id.tsx] |
| React Router | 7.15.1 | Frontend routing. | Existing frontend route files use React Router params and navigation. [VERIFIED: frontend/package-lock.json; frontend/app/routes/jobs.$id.tsx] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 3.25.76 | Request validation in API route modules. | Use for new request shapes if Phase 11 adds internal compatibility helpers or scaffolding routes. [VERIFIED: api/package-lock.json; api/src/routes/profile.ts; api/src/routes/discovery.ts] |
| pino | 9.14.0 | API request logging. | Keep using the existing logger middleware; extend tests for redaction rather than introducing a new logger. [VERIFIED: api/package-lock.json; api/src/middleware/logger.ts] |
| TypeScript | 5.9.3 API / 5.9.3 lock resolved | API compile-time compatibility. | Use API type tests/build when route response shapes change. [VERIFIED: api/package-lock.json; npm test output] |
| Vite | 6.4.2 frontend lock resolved | Frontend build tooling. | Use only for frontend typecheck/build validation; Phase 11 should avoid frontend-heavy changes unless compatibility tests require them. [VERIFIED: frontend/package-lock.json; frontend typecheck output] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing Hono route modules | New API framework or router abstraction | Do not switch frameworks; compatibility phase should preserve route behavior and test existing modules. [VERIFIED: 11-CONTEXT.md; api/src/index.ts] |
| Existing SQL migrations | ORM migration framework | Do not introduce a new ORM/migration stack; existing migrations are plain additive SQL. [VERIFIED: database/004_per_agent_models.sql; database/007_discovery.sql] |
| Existing `pipeline_events` SSE serialization | New event bus | Do not introduce a new event bus; SSE compatibility depends on the existing DB notification and serializer. [VERIFIED: api/src/sse.ts; database/003_pipeline_events_notify.sql] |

**Installation:**
```bash
# No new packages are recommended for Phase 11.
npm install   # only to restore existing API/frontend dependencies from lockfiles
uv sync       # only to restore existing Python dependencies from uv.lock
```

**Version verification:** Existing versions were verified from `api/package-lock.json`, `frontend/package-lock.json`, and `uv tree --depth 1`; no registry-based package discovery was needed because Phase 11 should not add dependencies. [VERIFIED: package lockfiles; uv tree]

## Package Legitimacy Audit

No external package installation is recommended for Phase 11, so the package legitimacy gate is not applicable. [VERIFIED: 11-CONTEXT.md; existing stack inspection]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No package additions recommended. [VERIFIED: research scope] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no package additions recommended]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no package additions recommended]

## Architecture Patterns

### System Architecture Diagram

```text
Existing clients
  |
  | POST /jobs, GET /jobs/*, EventSource /jobs/:id/events
  v
Hono API routes
  |-- submitJobUrl(url) -> INSERT jobs(status='new') -> runPipeline(...)
  |-- status/detail/resume/qa routes -> SELECT jobs/resume_versions/qa_reviews
  |-- SSE route -> replay pipeline_events -> LISTEN pipeline_events -> toPipelineEventPayload(row)
  v
PostgreSQL
  |-- jobs.status: pipeline lifecycle only
  |-- resume_versions: generated Markdown source history
  |-- qa_reviews: immutable QA history
  |-- pipeline_events: pipeline audit/SSE source only
  |-- triggers: sync iteration_count and qa_score
  v
Python pipeline
  Orchestrator -> Job Scout -> Resume Tailor -> Quality Analyst -> Confirmation
       |             |             |                |                 |
       +-------------+-------------+----------------+-----------------+
                     writes/reads PostgreSQL only

Future v4.1 domains
  |
  | additive tables only; separate app status/timeline; approved evidence only
  v
application_* / vault_* / evidence_* scaffolding
  |
  | no mutation of jobs.status; no raw private content in audit metadata
  v
redacted summaries, IDs, counts, hashes, bounded snippets
```

This diagram reflects current API/Python/PostgreSQL data flow and the Phase 11 future-domain boundary. [VERIFIED: api/src/job-submission.ts; agents/orchestrator.py; database/schema.sql; 11-CONTEXT.md]

### Recommended Project Structure

```text
api/src/
├── routes/jobs.ts              # Keep existing compatibility surface.
├── sse.ts                      # Keep stable SSE payload serializer.
├── pg-listener.ts              # Keep DB notification wake-up boundary.
├── job-submission.ts           # Add no-Vault URL submission compatibility tests here.
└── audit-redaction.ts          # Add only if needed: small shared redaction helper.

database/
├── schema.sql                  # Keep base schema compatible.
└── 008_compat_boundaries.sql   # Additive-only Phase 11 migration if scaffolding is needed.

agents/
├── orchestrator.py             # Preserve pipeline flow and status polling.
├── resume_tailor.py            # Add no-Vault fallback and prompt-redaction tests/implementation here if needed.
└── quality_analyst.py          # Remove/redact prompt trace payloads here.

tests/
├── test_resume_tailor.py       # Python guardrails for no-Vault fallback.
├── test_quality_analyst.py     # Python guardrails for prompt/audit redaction.
└── test_orchestrator.py        # Pipeline boundary tests if flow changes.

api/src/
├── routes/jobs.test.ts         # API compatibility and SSE tests.
├── job-submission.test.ts      # Job submission compatibility tests.
└── audit-redaction.test.ts     # API redaction helper tests if helper is TS-side.
```

Recommended files follow existing source/test organization and avoid adding a new framework. [VERIFIED: rg --files; AGENTS.md; api/package.json; pyproject.toml]

### Pattern 1: Additive API Response Evolution

**What:** Add nullable/new fields only; never rename, remove, narrow, or repurpose existing response fields. [VERIFIED: 11-CONTEXT.md]

**When to use:** Use for any job detail/status/QA/resume route touched by Phase 11. [VERIFIED: api/src/routes/jobs.ts]

**Example:**
```typescript
// Source: api/src/sse.ts
export function toPipelineEventPayload(row: PipelineEventRow): PipelineEventPayload {
  return {
    event_id: row.event_id,
    job_id: row.job_id,
    event_type: row.event_type,
    agent_name: row.agent_name,
    from_status: row.from_status,
    to_status: row.to_status,
    model_used: row.model_used,
    detail: row.detail,
    metadata: row.metadata,
    timestamp: row.timestamp,
  }
}
```

Planner should anchor SSE compatibility tests at this serializer because existing tests already assert the stable payload omits `created_at` and `payload`. [VERIFIED: api/src/sse.ts; api/src/routes/jobs.test.ts]

### Pattern 2: Additive SQL Migration

**What:** Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, idempotent indexes, and catalog guards for constraints. [VERIFIED: database/schema.sql; database/004_per_agent_models.sql; database/007_discovery.sql]

**When to use:** Use if Phase 11 creates compatibility scaffolding tables such as an application timeline shell or evidence ledger shell. [VERIFIED: 11-CONTEXT.md]

**Example:**
```sql
-- Source: database/004_per_agent_models.sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS model_job_scout        TEXT,
  ADD COLUMN IF NOT EXISTS model_resume_tailor    TEXT,
  ADD COLUMN IF NOT EXISTS model_quality_analyst  TEXT,
  ADD COLUMN IF NOT EXISTS model_confirmation     TEXT,
  ADD COLUMN IF NOT EXISTS model_orchestrator     TEXT;
```

Planner should explicitly forbid `UPDATE jobs SET qa_score = ...` and `UPDATE jobs SET iteration_count = ...` in migration or application code. [VERIFIED: database/schema.sql; AGENTS.md]

### Pattern 3: Redacted Audit Metadata

**What:** Audit rows should store identifiers, status transitions, counts, hashes, bounded summaries, and redacted snippets rather than raw prompts or full private content. [VERIFIED: 11-CONTEXT.md]

**When to use:** Use for every `pipeline_events`, future app timeline, or LLM metadata write touched by Phase 11. [VERIFIED: agents/orchestrator.py; agents/resume_tailor.py; agents/quality_analyst.py]

**Example target shape:**
```json
{
  "direction": "resume_tailor_to_llm",
  "iteration": 1,
  "prompt_length": 12345,
  "prompt_sha256": "hex-digest",
  "redacted": true,
  "included_sections": ["job_summary", "skills_counts", "resume_source"]
}
```

This target shape is a recommended implementation pattern derived from the locked redaction decision; it is not present in current source yet. [CITED: 11-CONTEXT.md]

### Anti-Patterns to Avoid

- **Extending `jobs.status` with application statuses:** This would mix pipeline lifecycle with user workflow state and break frontend assumptions around terminal pipeline states. [VERIFIED: 11-CONTEXT.md; frontend/app/lib/types.ts; api/src/sse.ts]
- **Storing raw prompt traces in `pipeline_events.payload`:** Current Resume Tailor and QA prompt traces include full prompts, which will become unsafe once Vault/recruiter/private notes enter prompts. [VERIFIED: agents/resume_tailor.py; agents/quality_analyst.py]
- **Replacing old response fields with new names:** Existing frontend types and route components consume `qa_score`, `iteration_count`, `active_resume_id`, `qa_review`, `pipeline_events`, and QA dimension fields. [VERIFIED: frontend/app/lib/types.ts; frontend/app/routes/jobs.$id.tsx; frontend/app/routes/jobs.$id_.qa.$rid.tsx]
- **Adding half-built user-facing Vault/Application routes:** Phase 11 may scaffold boundaries but should not ship later-domain workflows. [VERIFIED: 11-CONTEXT.md]
- **Testing by mocking internal collaborators:** Project TDD guidance says tests should exercise public behavior and mock only outer boundaries. [CITED: .agents/skills/tdd/SKILL.md; .agents/skills/tdd/mocking.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP routing | Custom Node HTTP dispatch | Existing Hono route modules | Existing clients and tests already target Hono-mounted routes. [VERIFIED: api/src/index.ts; api/src/routes/jobs.test.ts] |
| SSE serialization | Ad hoc event JSON in route handlers | `toPipelineEventPayload` | One serializer is the current compatibility point. [VERIFIED: api/src/sse.ts] |
| DB live event wakeups | Custom polling loop for API SSE | Existing `LISTEN pipeline_events` with catch-up query | Current listener design treats NOTIFY as a wake-up and re-queries canonical rows. [VERIFIED: api/src/pg-listener.ts; api/src/routes/jobs.ts] |
| Migration framework | ORM migration layer | Plain SQL migrations in `database/` | Existing migrations are idempotent SQL and do not use an ORM. [VERIFIED: database/*.sql] |
| Request validation | Manual shape checks for complex new JSON | zod in API routes | Existing profile/discovery routes use zod for structured request validation. [VERIFIED: api/src/routes/profile.ts; api/src/routes/discovery.ts] |
| Prompt/audit redaction | Per-call string slicing | Small shared redaction helper with tests | Per-call redaction is likely to miss future prompt and metadata writes. [VERIFIED: rg for `llm_prompt_trace`; 11-CONTEXT.md] |
| Pipeline state machine | New in-memory workflow tracker | Existing `jobs.status` plus `allowed_transitions` | Existing agents and API clients use the database state machine. [VERIFIED: database/schema.sql; agents/orchestrator.py] |

**Key insight:** Compatibility failures in this phase are more likely to come from changing semantics of existing fields or storing unsafe payloads than from missing libraries. [VERIFIED: 11-CONTEXT.md; codebase grep]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Existing PostgreSQL tables store pipeline state and artifacts: `jobs`, `resume_versions`, `qa_reviews`, `pipeline_events`, `user_profile`, `discovered_jobs`, and `search_preferences`. [VERIFIED: database/schema.sql; database/007_discovery.sql] Live row contents were not queried because `psql` is not installed in this shell and no DB connection was available. [VERIFIED: environment audit] | Treat migrations as additive and backward-compatible for existing rows. Planner should include a migration smoke test but not assume empty tables. [VERIFIED: 11-CONTEXT.md] |
| Live service config | No live external service configuration was queried. [VERIFIED: environment audit] Repo config references Telegram webhook env vars and scheduler process instructions; these are outside Phase 11 unless guardrail tests inspect no auto-email/no auto-apply boundaries. [VERIFIED: rg; docs/telegram-bot.md; scheduler.py] | Do not migrate live service config in Phase 11. Add static guardrail tests that no application/email sending path is introduced. [VERIFIED: REQUIREMENTS.md; 11-CONTEXT.md] |
| OS-registered state | No systemd, launchd, pm2, or Task Scheduler registration files were found in repo. [VERIFIED: rg] `scheduler.py` documentation suggests keeping a process alive via systemd/screen/supervisor-style tooling, but no registration was found in git. [VERIFIED: scheduler.py; rg] | No OS re-registration task required for Phase 11. [VERIFIED: rg] |
| Secrets/env vars | `.env` exists locally but was not read; environment variables currently exported to this shell did not include `DATABASE_URL`, `OPENROUTER_API_KEY`, `PROFILE_ENCRYPTION_KEY`, `RENDURE_API_KEY`, `TELEGRAM_*`, `JINA_API_KEY`, or `DEPLOY_TARGET`. [VERIFIED: `printenv` audit; `ls -la`] Source references `DATABASE_URL`, `OPENROUTER_API_KEY`, `PROFILE_ENCRYPTION_KEY`, `RENDURE_API_KEY`, Telegram env vars, and `JINA_API_KEY`. [VERIFIED: rg] | Do not rename existing env vars. Redaction tests should ensure secrets are not logged in API request logs or audit payloads. [VERIFIED: api/src/middleware/logger.test.ts; 11-CONTEXT.md] |
| Build artifacts | Existing artifacts include `.venv`, `api/node_modules`, `frontend/node_modules`, `api/dist`, `frontend/build`, and Python `__pycache__` directories. [VERIFIED: find] | No artifact migration required; do not commit generated artifacts. [VERIFIED: .gitignore; AGENTS.md] |

## Common Pitfalls

### Pitfall 1: Treating `jobs.status` as a General Application Status

**What goes wrong:** Application statuses such as `saved`, `applied`, or `interviewing` get added to `jobs.status`. [VERIFIED: REQUIREMENTS.md; 11-CONTEXT.md]

**Why it happens:** `jobs.status` already looks like a convenient workflow state field. [VERIFIED: database/schema.sql]

**How to avoid:** Keep `jobs.status` limited to pipeline states and add separate future application tables/status columns. [VERIFIED: 11-CONTEXT.md]

**Warning signs:** Changes to `allowed_transitions`, frontend `JobStatus`, or `TERMINAL_STATUSES` that include application statuses. [VERIFIED: database/schema.sql; frontend/app/lib/types.ts; api/src/sse.ts]

### Pitfall 2: Breaking SSE by Adding Payload Fields in the Wrong Place

**What goes wrong:** Clients receive changed event names or payload shape, or sensitive `payload` content leaks through SSE. [VERIFIED: api/src/sse.ts; api/src/routes/jobs.test.ts]

**Why it happens:** `pipeline_events` has both `metadata` and `payload`, but current SSE serialization exposes only `metadata` and omits `payload`. [VERIFIED: api/src/sse.ts; database/schema.sql]

**How to avoid:** Keep `PIPELINE_SSE_EVENT = 'pipeline_event'`, keep `toPipelineEventPayload` stable, and add explicit tests that `payload` remains excluded. [VERIFIED: api/src/sse.ts; api/src/routes/jobs.test.ts]

**Warning signs:** Route code serializes DB rows directly instead of using `toPipelineEventPayload`. [VERIFIED: api/src/routes/jobs.ts]

### Pitfall 3: Redaction Only in API Logs, Not in DB Audit Rows

**What goes wrong:** Request logs look safe, but private prompts or future Vault evidence get stored in `pipeline_events.payload`. [VERIFIED: api/src/middleware/logger.ts; agents/resume_tailor.py; agents/quality_analyst.py]

**Why it happens:** API logging and Python audit inserts are separate code paths. [VERIFIED: api/src/middleware/logger.ts; agents/*.py]

**How to avoid:** Add tests around Python prompt-trace rows and any future TS helper that writes audit/timeline metadata. [VERIFIED: tests/test_quality_analyst.py; tests/test_resume_tailor.py; 11-CONTEXT.md]

**Warning signs:** JSON metadata keys named `prompt`, `raw_prompt`, `resume_text`, `private_notes`, `recruiter_email`, or `full_content`. [VERIFIED: rg for current prompt keys]

### Pitfall 4: No-Vault Fallback Breaks Because Resume Tailor Requires Profile Resume

**What goes wrong:** Existing URL-to-resume flow fails when no future Vault tables exist or when Vault is empty/unavailable. [VERIFIED: COMPAT-01; EVID-02]

**Why it happens:** Current Resume Tailor reads `user_profile.resume_text` for first iteration and raises if it is missing. [VERIFIED: agents/resume_tailor.py; tests/test_resume_tailor.py]

**How to avoid:** Define "no Vault" as no approved Vault evidence, not "no base resume/profile"; preserve current base resume/profile requirements while ensuring future Vault retrieval is optional. [VERIFIED: agents/resume_tailor.py; REQUIREMENTS.md]

**Warning signs:** Tailoring code treats an empty future evidence set as an error. [VERIFIED: REQUIREMENTS.md]

### Pitfall 5: Guardrail Tests Written as Broad Static Sweeps Only

**What goes wrong:** Tests pass because no forbidden string exists, while behavior can still send email, auto-apply, or write unapproved evidence through a new route. [CITED: .agents/skills/tdd/tests.md]

**Why it happens:** Static grep tests are easier than behavior tests. [CITED: .agents/skills/tdd/SKILL.md]

**How to avoid:** Use behavior tests through public API/agent interfaces, with static sweeps only as supplemental tripwires. [CITED: .agents/skills/tdd/tests.md; .agents/skills/tdd/mocking.md]

**Warning signs:** A single test only checks that the string `sendEmail` is absent. [CITED: .agents/skills/tdd/tests.md]

## Code Examples

### Existing Job Submission Boundary

```typescript
// Source: api/src/job-submission.ts
const insert = await pool.query(
  `INSERT INTO jobs (job_url, status) VALUES ($1, 'new') RETURNING job_id`,
  [url],
)
runPipeline(url, job_id, pool, pipelineEnv)
return {
  statusCode: 202,
  body: { job_id, status: 'new', status_url: statusUrl(job_id) },
}
```

Use this boundary for COMPAT-01 tests because it is shared by the route and pipeline spawn flow. [VERIFIED: api/src/job-submission.ts; api/src/job-submission.test.ts]

### Existing Pipeline Event Notification Boundary

```sql
-- Source: database/003_pipeline_events_notify.sql
PERFORM pg_notify(
    'pipeline_events',
    json_build_object(
        'job_id', NEW.job_id,
        'event_id', NEW.event_id
    )::text
);
```

The notification payload intentionally excludes `detail`, `metadata`, and `payload`; the API re-queries canonical rows before sending SSE. [VERIFIED: database/003_pipeline_events_notify.sql; api/src/pg-listener.test.ts]

### Current Prompt Trace That Needs Redaction

```python
# Source: agents/resume_tailor.py
json.dumps({
    "direction": "resume_tailor→llm",
    "iteration": iteration_number,
    "prompt_length": len(prompt),
    "prompt": prompt,
})
```

The planner should replace or redact the `prompt` value and add a regression test proving raw prompt content is not stored in audit rows. [VERIFIED: agents/resume_tailor.py; 11-CONTEXT.md]

### Current API Logger Redaction Pattern

```typescript
// Source: api/src/middleware/logger.ts
const fields: Record<string, unknown> = {
  request_id,
  method: c.req.method,
  path,
  status: c.res.status,
  duration_ms,
}
if (job_id !== undefined) fields.job_id = job_id
logger.info(fields)
```

This is the pattern to preserve: log method/path/status/duration/job_id, not headers or bodies. [VERIFIED: api/src/middleware/logger.ts; api/src/middleware/logger.test.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Git-branch-based tailored resume storage described in older AGENTS sections | DB-stored resume versions with nullable `git_branch` and `git_commit` | Present in current source as of 2026-06-23 research | Planner should preserve DB resume retrieval and not plan Git branch compatibility work. [VERIFIED: AGENTS.md; database/schema.sql; agents/resume_tailor.py] |
| Four-dimension QA formula in older docs | Current QA implementation computes six dimensions internally but persists only existing schema columns plus payload diagnostics | Present in current source as of 2026-06-23 research | API compatibility must keep existing QA response fields; schema currently has no `ats_parseable` or `bullet_impact` columns. [VERIFIED: agents/quality_analyst.py; database/schema.sql; api/src/routes/jobs.ts] |
| Poll-only frontend progress | SSE route plus DB NOTIFY wake-up and catch-up query | Present in current source as of 2026-06-23 research | SSE event name and payload shape must remain stable. [VERIFIED: api/src/routes/jobs.ts; api/src/sse.ts; database/003_pipeline_events_notify.sql] |
| API logs as ad hoc console output | Pino middleware with structured fields and redaction-by-omission | Present in current source as of 2026-06-23 research | Extend existing logger tests rather than replacing logging. [VERIFIED: api/src/middleware/logger.ts; api/src/middleware/logger.test.ts] |

**Deprecated/outdated:**
- AGENTS references `db/schema.sql`, but current repo uses `database/schema.sql`. [CITED: AGENTS.md; VERIFIED: rg --files]
- `.planning/codebase/TESTING.md` says no tests exist, but current repo has 99 Python tests and 197 API tests. [VERIFIED: .planning/codebase/TESTING.md; test command outputs]
- AGENTS describes `AntigravityLLM` as universal, but current code routes LLM calls through `utils/llm.py` and OpenRouter/Codex OAuth abstractions. [CITED: AGENTS.md; VERIFIED: utils/llm.py; agents/*.py]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | No `[ASSUMED]` claims were used as recommendations in this research. [VERIFIED: source review] | — | — |

## Open Questions

1. **Should Phase 11 remove existing `llm_prompt_trace` rows from live databases or only stop future writes?**
   - What we know: current code can write full prompts into `pipeline_events.payload`. [VERIFIED: agents/resume_tailor.py; agents/quality_analyst.py]
   - What's unclear: no live DB was queried, so existing row contents and retention expectations are unknown. [VERIFIED: environment audit]
   - Recommendation: plan code/test remediation now and add a human-checkpoint or optional one-off migration only if live data needs cleanup. [VERIFIED: 11-CONTEXT.md]

2. **Should the Python orchestrator continue auto-building PDFs after confirmation?**
   - What we know: API PDF retrieval is existing client behavior, but the Python orchestrator calls `_export_and_build_pdf` after confirmation. [VERIFIED: api/src/routes/jobs.ts; agents/orchestrator.py]
   - What's unclear: AGENTS says PDF rendering is manual, while current CLI behavior attempts RenderCV Docker after approval. [CITED: AGENTS.md; VERIFIED: agents/orchestrator.py]
   - Recommendation: preserve API PDF route compatibility, then decide whether CLI auto-render is an existing behavior to keep or a guardrail violation to test and remove. [VERIFIED: COMPAT-02; 11-CONTEXT.md]

3. **Should Phase 11 create empty future-domain tables or only tests/docs?**
   - What we know: context allows compatibility scaffolding but forbids half-built user-facing workflows. [VERIFIED: 11-CONTEXT.md]
   - What's unclear: planner must decide whether guardrail tests alone are sufficient or whether additive tables like `application_timeline` should exist before Phase 14. [VERIFIED: ROADMAP.md]
   - Recommendation: prefer tests/helpers first; add schema scaffolding only if it directly enforces COMPAT-04/05 without exposing routes. [VERIFIED: 11-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | API tests/build | yes | v22.22.3 | none needed. [VERIFIED: environment audit] |
| npm | API/frontend package scripts | yes | 10.9.8 | none needed. [VERIFIED: environment audit] |
| uv | Python tests and dependency sync | yes | 0.9.18 | none needed. [VERIFIED: environment audit] |
| Python via uv | Python tests/agents | yes | 3.12.11 | use `uv run python`, not system Python 3.14.4. [VERIFIED: environment audit] |
| Docker | Optional RenderCV PDF rendering | yes | 29.4.0 | API already returns 503 if RenderCV unavailable; Phase 11 should not require Docker for unit tests. [VERIFIED: environment audit; api/src/routes/jobs.ts] |
| psql | Live DB inspection/migration manual checks | no | — | Use SQL file review and test DB mocks unless a live DB check is explicitly needed. [VERIFIED: environment audit] |
| slopcheck | Package legitimacy audit | no | — | Not needed because no new package additions are recommended. [VERIFIED: environment audit; Package Legitimacy Audit] |

**Missing dependencies with no fallback:**
- `psql` is unavailable for live DB inspection; planning should not require live row inspection unless the user provides a DB client or connection workflow. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- `slopcheck` is unavailable, but Phase 11 should not install new packages. [VERIFIED: environment audit]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| API framework | Vitest 4.1.5 via `npm test` in `api/`. [VERIFIED: api/package-lock.json; test output] |
| API config file | none detected; script is in `api/package.json`. [VERIFIED: find; api/package.json] |
| API quick run command | `cd api && npm test` [VERIFIED: api/package.json; test output] |
| Python framework | pytest 9.0.3 via `uv run pytest tests/`. [VERIFIED: uv tree; test output] |
| Python config file | `pyproject.toml` is detected as pytest root config by pytest. [VERIFIED: test output] |
| Python quick run command | `uv run pytest tests/` [VERIFIED: test output] |
| Frontend typecheck | `cd frontend && npm run typecheck` [VERIFIED: frontend/package.json; typecheck output] |

### Current Baseline

| Command | Result |
|---------|--------|
| `cd api && npm test` | 18 files passed; 196 tests passed and 1 skipped. [VERIFIED: command output] |
| `uv run pytest tests/` | 99 tests passed with 2 warnings. [VERIFIED: command output] |
| `cd frontend && npm run typecheck` | Passed. [VERIFIED: command output] |
| `cd api && npm test -- --runInBand` | Failed because Vitest does not support Jest's `--runInBand` option. [VERIFIED: command output] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| COMPAT-01 | URL submission works without future Vault setup and still dispatches pipeline. | API unit/integration-style with mocked DB/spawn | `cd api && npm test -- job-submission.test.ts` | yes, extend `api/src/job-submission.test.ts`. [VERIFIED: file exists] |
| COMPAT-01 | Resume Tailor handles empty/unavailable future Vault evidence without failing. | Python behavior test with DB/LLM boundary mocks | `uv run pytest tests/test_resume_tailor.py -x` | yes, extend `tests/test_resume_tailor.py`. [VERIFIED: file exists] |
| COMPAT-02 | Job detail/status/resume/PDF/QA routes keep existing fields and content types. | API route tests | `cd api && npm test -- routes/jobs.test.ts` | yes, extend `api/src/routes/jobs.test.ts`. [VERIFIED: file exists] |
| COMPAT-02 | SSE event name and payload shape remain stable and exclude `payload`. | API serializer/SSE tests | `cd api && npm test -- routes/jobs.test.ts` | yes, existing serializer test should be extended. [VERIFIED: api/src/routes/jobs.test.ts] |
| COMPAT-03 | Migrations are additive and never update trigger-owned columns. | SQL static test | `cd api && npm test -- pg-listener.test.ts` or new migration test | partial; add new migration test. [VERIFIED: api/src/pg-listener.test.ts] |
| COMPAT-04 | Application workflow status does not appear in `jobs.status` or `allowed_transitions`. | SQL/static + API behavior test | `cd api && npm test` | no dedicated test; Wave 0 gap. [VERIFIED: rg tests] |
| COMPAT-05 | Application timeline/audit events are separate from `pipeline_events`. | SQL/static/API test | `cd api && npm test` | no dedicated test; Wave 0 gap. [VERIFIED: rg tests] |
| COMPAT-06 | Raw prompts, private notes, recruiter/contact details, and full generated content are not stored in logs/audit metadata. | Python + API redaction tests | `uv run pytest tests/test_quality_analyst.py tests/test_resume_tailor.py -x`; `cd api && npm test -- middleware/logger.test.ts` | partial; logger tests exist, prompt/audit tests missing. [VERIFIED: files and rg] |
| GUARD-06 | Approval-gated evidence writes cannot create trusted evidence from AI extraction. | API/SQL guardrail test | `cd api && npm test` | missing; Wave 0 gap. [VERIFIED: rg tests] |
| GUARD-06 | Missing evidence requires source provenance. | API/SQL guardrail test | `cd api && npm test` | missing; Wave 0 gap. [VERIFIED: rg tests] |
| GUARD-06 | No automatic application submission or browser automation path exists. | Static tripwire plus behavior test when app routes exist | `uv run pytest tests/ && cd api && npm test` | missing dedicated test; Wave 0 gap. [VERIFIED: rg tests] |
| GUARD-06 | No automatic recruiter email sending exists. | Static tripwire plus route behavior test when CRM routes exist | `cd api && npm test` | missing dedicated test; Wave 0 gap. [VERIFIED: rg tests] |

### Sampling Rate

- **Per task commit:** Run the smallest touched test command, such as `cd api && npm test -- routes/jobs.test.ts` or `uv run pytest tests/test_resume_tailor.py -x`. [VERIFIED: existing test commands]
- **Per wave merge:** Run `cd api && npm test`, `uv run pytest tests/`, and `cd frontend && npm run typecheck`. [VERIFIED: command outputs]
- **Phase gate:** Full API tests, full Python tests, and frontend typecheck must be green before `$gsd-verify-work`. [VERIFIED: AGENTS.md; command outputs]

### Wave 0 Gaps

- [ ] Add API compatibility tests for route response field stability across `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/status`, `GET /jobs/:id/resumes`, Markdown, PDF, and QA list routes. [VERIFIED: api/src/routes/jobs.ts; api/src/routes/jobs.test.ts]
- [ ] Add SSE compatibility test proving event name remains `pipeline_event` and serialized payload excludes DB `payload`. [VERIFIED: api/src/sse.ts; api/src/routes/jobs.test.ts]
- [ ] Add SQL/static tests for additive migration boundaries and no writes to `jobs.qa_score` / `jobs.iteration_count`. [VERIFIED: database/schema.sql; existing migration patterns]
- [ ] Add Python prompt-redaction tests for Resume Tailor and Quality Analyst prompt-trace rows. [VERIFIED: agents/resume_tailor.py; agents/quality_analyst.py]
- [ ] Add guardrail tests for no auto-apply and no automatic email sending as static tripwires plus behavior checks where routes exist. [VERIFIED: REQUIREMENTS.md; rg]
- [ ] Add no-Vault evidence fallback test that future Vault absence/empty results do not break base URL tailoring. [VERIFIED: REQUIREMENTS.md; tests/test_resume_tailor.py]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing API key middleware protects `/jobs/*`, `/profile/*`, and `/discovery/*`; Phase 11 should not add unauthenticated protected routes. [VERIFIED: api/src/index.ts; api/src/middleware/apiKey.ts; OWASP ASVS category cited: https://owasp.org/www-project-application-security-verification-standard/] |
| V3 Session Management | limited | No browser user session layer exists for these routes; API key and optional Codex OAuth status endpoints are the relevant surfaces. [VERIFIED: api/src/index.ts; api/src/routes/codex-auth.ts] |
| V4 Access Control | yes | Single-user product still requires route-level API key checks and no unintended mutation paths. [VERIFIED: .planning/PROJECT.md; api/src/index.ts] |
| V5 Input Validation | yes | zod is already used for structured profile/discovery inputs; URL submission uses URL parsing and non-empty checks. [VERIFIED: api/src/routes/profile.ts; api/src/routes/discovery.ts; api/src/job-submission.ts] |
| V6 Cryptography | yes | Profile secrets use AES-GCM helpers backed by `PROFILE_ENCRYPTION_KEY`; do not hand-roll new crypto for Phase 11. [VERIFIED: api/src/crypto.ts; utils/crypto.py] |
| V7 Error Handling and Logging | yes | Phase 11 directly changes logging/audit redaction behavior; request logs already omit bodies/headers, but DB audit rows need prompt/private-data redaction. [VERIFIED: api/src/middleware/logger.ts; agents/resume_tailor.py; agents/quality_analyst.py] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt/private evidence leakage into audit rows | Information Disclosure | Store IDs, counts, hashes, bounded summaries, and redacted snippets; test absence of raw prompt/private fields. [VERIFIED: 11-CONTEXT.md; agents/resume_tailor.py; agents/quality_analyst.py] |
| Application status pollution in pipeline state | Tampering | Keep application status in separate future tables and block application states in `allowed_transitions`. [VERIFIED: 11-CONTEXT.md; database/schema.sql] |
| SQL injection in route changes | Tampering | Continue parameterized `pool.query` / psycopg2 parameter patterns. [VERIFIED: api/src/routes/jobs.ts; agents/*.py; AGENTS.md] |
| Prompt injection from job postings | Spoofing/Tampering | Keep Job Scout instruction to ignore scraped-page instructions and log only a bounded warning. [VERIFIED: agents/job_scout.py; AGENTS.md] |
| Secret leakage in request logs | Information Disclosure | Preserve logger field allowlist and tests excluding `X-API-Key` and request body. [VERIFIED: api/src/middleware/logger.ts; api/src/middleware/logger.test.ts] |
| Automatic email/application side effects | Elevation of Privilege/Tampering | Do not add send/apply/browser automation routes; add guardrail tests. [VERIFIED: REQUIREMENTS.md; 11-CONTEXT.md; rg] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/11-architecture-compatibility-and-migration-plan/11-CONTEXT.md` - locked Phase 11 decisions, canonical refs, compatibility scope. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - COMPAT-01 through COMPAT-06 and GUARD-06 definitions. [VERIFIED: file read]
- `.planning/ROADMAP.md` - Phase 11 goal, dependencies, and success criteria. [VERIFIED: file read]
- `.planning/STATE.md` - current milestone state and decisions. [VERIFIED: file read]
- `.planning/PROJECT.md` - project-level v4.1 constraints and non-negotiables. [VERIFIED: file read]
- `AGENTS.md` - TDD, database, pipeline, and safety constraints; some implementation details are stale and were cross-checked against source. [VERIFIED: file read]
- `api/src/routes/jobs.ts` - existing API route compatibility surface. [VERIFIED: file read]
- `api/src/sse.ts` - SSE event name, terminal statuses, and payload serializer. [VERIFIED: file read]
- `api/src/pg-listener.ts` and `database/003_pipeline_events_notify.sql` - DB notification wake-up boundary. [VERIFIED: file read]
- `api/src/job-submission.ts` - URL submission and pipeline dispatch boundary. [VERIFIED: file read]
- `database/schema.sql` and migrations `004` through `007` - schema, trigger-owned columns, additive migration examples. [VERIFIED: file read]
- `agents/orchestrator.py`, `agents/job_scout.py`, `agents/resume_tailor.py`, `agents/quality_analyst.py`, `agents/confirmation.py` - pipeline flow, status writes, audit writes. [VERIFIED: file read]
- Existing tests in `api/src/*.test.ts` and `tests/*.py` - current test patterns and gaps. [VERIFIED: file read; test commands]
- `.agents/skills/tdd/SKILL.md`, `.agents/skills/tdd/tests.md`, `.agents/skills/tdd/mocking.md` - project-local TDD guidance. [VERIFIED: file read]

### Secondary (MEDIUM confidence)

- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STACK.md`, `.planning/codebase/TESTING.md` - useful historical context, but parts are stale compared with current source/tests. [VERIFIED: file read]
- `graphify-out/GRAPH_REPORT.md` - graph hints from 2026-05-13; graph is stale and query results returned no nodes for Phase 11 terms. [VERIFIED: graphify status; file read]
- OWASP ASVS project page - category reference only, not used for code-specific claims. [CITED: https://owasp.org/www-project-application-security-verification-standard/]

### Tertiary (LOW confidence)

- None. [VERIFIED: source hierarchy used]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions were verified from lockfiles and `uv tree`. [VERIFIED: package lockfiles; uv tree]
- Architecture: HIGH - route, agent, schema, and test surfaces were read directly. [VERIFIED: source files]
- Pitfalls: HIGH for prompt audit leakage and status separation because both are visible in source/context; MEDIUM for live runtime cleanup because DB contents were not queried. [VERIFIED: source files; environment audit]
- Runtime state: MEDIUM - repo state was audited, but live PostgreSQL rows and local `.env` contents were not inspected. [VERIFIED: environment audit]

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 for codebase-local compatibility findings; re-run dependency/version checks before package changes. [VERIFIED: current date; package lockfiles]
