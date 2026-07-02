# Technology Stack

**Project:** Rendure v4.1 - Job Search Operating System v1
**Researched:** 2026-06-22
**Scope:** Stack additions and integration points for Career Vault evidence modeling/approval, resume evidence extraction, application tracking, recruiter CRM reminders, and explainable match scoring.
**Overall recommendation:** Preserve the current Hono + React Router + PostgreSQL + Python agents architecture. Add tables, routes, agent/helper modules, and UI routes. Do not add a new database, queue, ORM, search engine, vector store, auth layer, or autonomous email/apply integration for v4.1.

## Current Stack Verified Locally

### Backend/API

| Technology | Resolved Version | Purpose | v4.1 Use |
|------------|------------------|---------|----------|
| Hono | 4.12.18 | Node API framework | Add `/vault`, `/applications`, `/contacts`, `/follow-ups`, and `/matches` route modules alongside existing `/jobs`, `/profile`, and `/discovery`. |
| `@hono/node-server` | 1.19.14 | API runtime | Keep the current Node server. No FastAPI or separate service. |
| `pg` | 8.20.0 | PostgreSQL access | Continue raw parameterized SQL and the existing adapter boundary. |
| Zod | 3.25.76 | Request/LLM output validation | Reuse existing safe-parse route validation pattern from `profile.ts`; no validator middleware required initially. |
| `pdf-parse` | 2.4.5 | PDF resume text extraction | Generalize existing profile resume upload into Vault source artifact ingestion. |
| `yaml` | 2.9.0 | Structured file parsing | Keep for existing resume/profile flows; not central to Vault. |
| Vitest | 4.1.5 | API tests | Use for route, schema mapper, and DB helper tests. |
| TypeScript | 5.9.3 resolved, `^5.8.3` manifest | API type safety | Keep. |

### Frontend

| Technology | Resolved Version | Purpose | v4.1 Use |
|------------|------------------|---------|----------|
| React | 19.2.6 resolved, `^19.0.0` manifest | UI | Add Vault review, application board/detail, CRM reminders, and match explanation screens. |
| React Router | 7.15.1 resolved | Routing/data framework | Add routes under existing `frontend/app/routes/`; no Next.js or TanStack migration. |
| React Markdown | 10.1.0 | Markdown rendering | Reuse for source snippets, JD snapshots, resume text, and explanation copy. |
| remark-gfm | 4.0.1 | GitHub-flavored Markdown | Keep for resume/JD rendering. |
| Vite | 6.4.2 resolved, `^6.0.0` manifest | Build/dev server | Keep. |

### Python Agents

| Technology | Resolved Version | Purpose | v4.1 Use |
|------------|------------------|---------|----------|
| Python | `>=3.12` | Agent runtime | Keep. |
| LangChain / langchain-core | 1.2.10 / 1.2.16 | Existing LLM wrapper integration | Keep only where already used by agents. Do not introduce LangGraph for v4.1. |
| psycopg2-binary | 2.9.11 | Agent DB access | Keep for existing agents while preserving DB as source of truth. |
| httpx / requests | 0.28.1 / 2.32.5 | HTTP calls | Reuse for Jina/OpenRouter/Codex calls. |
| APScheduler | 3.11.2 | Existing scheduling dependency | Reuse for follow-up reminder scans only if the current Telegram/discovery scheduling path already runs in the target. Prefer DB queries on page load/API request for MVP reminders. |
| pytest | 9.0.3 | Python tests | Use for evidence ranking, match scoring helpers, and any new agent modules. |

## Recommended Stack Additions

### Database

| Addition | Technology | Why |
|----------|------------|-----|
| Career Vault schema | PostgreSQL migrations in `database/`, folded into `database/schema.sql` | The Vault is authoritative user data, so it belongs in the same source-of-truth DB as `jobs`, `resume_versions`, and `qa_reviews`. |
| Evidence provenance model | Normalized tables plus join tables | Every trusted claim must trace to source artifacts and approval state. This is relational data, not a document blob. |
| Candidate approval queue | Tables such as `vault_source_artifacts`, `vault_extraction_runs`, `vault_candidates`, `vault_candidate_groups` | AI extraction should create candidates only. Approval/merge/reject should be explicit and auditable. |
| Trusted evidence tables | `career_roles`, `career_projects`, `career_achievements`, `career_skills`, `career_certifications`, `career_star_stories`, `evidence_sources` | Use typed tables for records the UI edits and the tailoring/match systems retrieve. Keep flexible extraction metadata in JSONB columns. |
| Resume evidence usage | `resume_version_evidence_usage(version_id, evidence_type, evidence_id, usage_context)` | Non-negotiable requirement: every generated resume version using Vault evidence records evidence IDs. |
| Application tracker tables | `applications`, `application_documents`, `application_activity_events`, optional `application_notes` | Keep application state separate from `jobs`. Link to `jobs.job_id` and `resume_versions.version_id` when created from tailoring. |
| Recruiter CRM tables | `contacts`, `application_contacts`, `follow_up_reminders` | Contacts are reusable across applications; reminders should be queryable by due date/status. |
| Match scoring tables | `job_match_assessments`, `job_match_dimensions`, `job_match_evidence_links` | Store coarse fit bucket, dimension breakdowns, evidence links, limitations, and top actions as explainable artifacts. |

Use CHECK constraints for status/state fields:

- Vault candidate state: `pending`, `approved`, `merged`, `rejected`
- Application status: `saved`, `applied`, `interviewing`, `offer`, `rejected`, `archived`
- Reminder status: `pending`, `snoozed`, `dismissed`, `completed`
- Match bucket: `strong`, `plausible`, `stretch`, `weak`, `blocked`

Do not add `pgvector`, Elasticsearch, Meilisearch, or a document database for v4.1. Single-user scale plus evidence explainability favors normalized Postgres queries. If search becomes slow later, evaluate Postgres full-text search first; official PostgreSQL docs identify GIN as the preferred index type for text search, and `pg_trgm` supports similarity search, but those should be later performance enhancements because the current milestone needs PGlite/schema portability and transparent evidence links more than fuzzy search infrastructure.

### API

| Addition | Technology | Why |
|----------|------------|-----|
| Route modules | Hono route modules under `api/src/routes/` | Matches current `jobs.ts`, `profile.ts`, `discovery.ts` structure. |
| Validation | Existing Zod safe-parse pattern | The project already validates `PATCH /profile` this way. Keep errors consistent through `httpError`. |
| Data access | Existing `pool.query` with parameterized SQL | Avoid adding Prisma/Drizzle. The existing schema uses triggers, JSONB, raw SQL, and a DB adapter boundary. |
| File ingestion | Extend current `/profile/resume` upload code into `/vault/sources` | Existing code already supports PDF, Markdown, text, `pdf-parse`, and LLM parsing. |
| Structured LLM output | Zod schemas per extraction/scoring payload | LLM output must be candidate data with provenance, not trusted writes. Validate before insert. |
| Eventing | Existing `pipeline_events` and SSE pattern where the user benefits from progress | Resume extraction across multiple files can take long enough to emit events. Application CRUD does not need SSE. |

Recommended route surface:

| Route Group | Purpose |
|-------------|---------|
| `/vault/sources` | Upload/list resume or text artifacts; store raw extracted text and metadata. |
| `/vault/extraction-runs` | Start/list extraction runs over two or more sources. |
| `/vault/candidates` | Review, approve, edit, reject, and merge extracted candidate evidence. |
| `/vault/records` | Browse/search trusted Roles, Projects, Achievements, Skills, Certifications, STAR stories. |
| `/applications` | Application CRUD, status changes, notes, document links, stale/follow-up indicators. |
| `/contacts` | Recruiter/contact CRUD and links to applications. |
| `/follow-ups` | Reminder queue, snooze, dismiss, complete, draft generation. |
| `/jobs/:id/match` | Generate/read explainable match score for a job using JD + trusted Vault evidence. |

Do not add `@hono/zod-validator` yet. The latest package is 0.8.0, and Hono supports validator middleware patterns, but the existing codebase already has explicit safe-parse validation with custom error bodies. Add middleware only if route validation becomes repetitive enough to justify a local convention change.

### Resume Evidence Extraction

| Decision | Recommendation |
|----------|----------------|
| Required formats | Reuse existing PDF, Markdown, and text support first. |
| Optional `.docx` support | Add `mammoth@^1.12.0` to `api` only if v4.1 explicitly accepts Word resumes. Mammoth is designed for semantic `.docx` to HTML/text conversion; it is a small API dependency, not infrastructure. |
| Extraction location | Keep ingestion in the Hono API boundary, then call an extraction helper/agent that writes candidates to Postgres. |
| LLM provider | Reuse existing OpenRouter and Codex OAuth provider logic from `resume-parse.ts`. |
| Approval model | Insert candidates and provenance first; only approval endpoints create trusted Vault records. |
| Duplicate grouping | Start with deterministic normalization plus LLM-proposed grouping: normalized company/title/date ranges for roles, normalized skill names for skills, and token overlap for achievement statements. No fuzzy library is required for MVP. |

If extraction latency is poor, introduce a new ephemeral Python module such as `agents/career_vault_extractor.py` using the existing subprocess/agent pattern. Do not add Celery, BullMQ, Temporal, or Redis for v4.1.

### Tailoring Integration

| Addition | Technology | Why |
|----------|------------|-----|
| Evidence retrieval helper | Python helper under `agents/` or API-side query helper | Resume Tailor needs ranked trusted evidence for a JD without changing the current pipeline contract more than necessary. |
| Evidence ranking | Deterministic SQL + lightweight scoring function | Rank by required skills overlap, role/project recency, seniority, domain/stack terms, and user preferences. Keep the score explainable. |
| Usage recording | `resume_version_evidence_usage` insert immediately after `resume_versions` insert | Keeps old resume versions compatible and records evidence use for new versions. |
| Prompt grounding | Include evidence IDs and source summaries in Resume Tailor prompt | Prevents fabricated claims and gives QA/match UI traceability. |

Do not make Career Vault a hard dependency for the existing URL-to-resume flow at the start of the milestone. The current flow should continue using base resume text if the Vault is empty or no evidence is approved.

### Application Tracker and CRM

| Addition | Technology | Why |
|----------|------------|-----|
| Status board | React Router route plus existing CSS/fetch client | Enough for MVP. Store ordering by status/date; no state library needed. |
| Drag and drop | Optional `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` | Use only if the Kanban board requires true drag/drop. dnd-kit is current and accessible; avoid `react-beautiful-dnd`, which is archived/deprecated. |
| Reminder queue | SQL date filters over `follow_up_reminders` and `applications.next_follow_up_at` | No scheduler needed for in-app reminder display. |
| Telegram reminders | Reuse existing Telegram notifier only if phase scope includes push reminders | Do not create a new notification service. |
| Follow-up drafts | Existing LLM provider path with Zod output validation | Draft only; never send email. |

### Explainable Job-Match Score

| Addition | Technology | Why |
|----------|------------|-----|
| Scoring engine | Python or TypeScript pure function with tests | The score should be deterministic enough to explain and test. LLM can summarize evidence but should not be the sole scorer. |
| Dimensions | Stored rows in `job_match_dimensions` | Enables UI to show breakdowns, supporting evidence, and limitations. |
| Evidence links | Join table to JD snippets, Vault evidence IDs, and resume version IDs | Required for explainability. |
| Buckets | Enum/check-constrained coarse buckets | Avoid false precision. Store optional numeric internals only for sorting/debugging, not as the primary UX. |

The match score should reuse parsed `jobs.required_skills`, `jobs.nice_to_haves`, `jobs.seniority_level`, `jobs.location`, trusted Vault evidence, and existing resume versions. It should not claim ATS prediction, recruiter interest prediction, or interview probability.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Persistence | Existing PostgreSQL schema + migrations | MongoDB/document DB | Evidence approval, provenance, joins, status history, and resume usage are relational. |
| Semantic retrieval | SQL + transparent ranking | pgvector/vector DB | v4.1 requires explainable evidence, not opaque nearest-neighbor matches. Adds migration/PGlite complexity. |
| Search | Simple SQL filters first | Elasticsearch/Meilisearch | Single-user dataset; operational cost is unjustified. |
| API framework | Existing Hono | FastAPI/NestJS | Hono routes are already working and tested. Rebuild adds risk without feature value. |
| DB access | Existing `pg` raw SQL | Prisma/Drizzle | Existing code and schema use raw SQL, triggers, and adapter seams. ORM migration would be unrelated churn. |
| Background jobs | Existing subprocess/agent pattern | Celery/BullMQ/Temporal/Redis | v4.1 has no multi-user throughput requirement. Existing self-hosted pipeline already manages long-running work. |
| Kanban interaction | Native controls first, dnd-kit optional | react-beautiful-dnd | react-beautiful-dnd is archived/deprecated. |
| Resume upload parsing | Existing `pdf-parse`, optional `mammoth` | Browser-only parsing | Server/API boundary already handles uploads and provider calls. Keep source artifact ingestion centralized. |
| Auth/multi-user | Existing single API key/single-user model | Clerk/Auth.js/OIDC | Single-user self-hosted trust model is a validated decision. |
| Email | Draft-only UI | Gmail/SMTP sending | Milestone explicitly forbids automatic sending. |

## Installation

No required dependency additions for the core v4.1 backend, database, Python agents, or frontend.

Only add these if the corresponding phase explicitly needs them:

```bash
# API: accept .docx resumes as Career Vault source artifacts
cd api
npm install mammoth@^1.12.0

# Frontend: true drag/drop Kanban after the non-DnD board works
cd frontend
npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

No Python packages are recommended for v4.1. Existing `pyproject.toml` dependencies are sufficient for agent helpers, HTTP calls, DB access, testing, scraping, and scheduling.

## Integration Points

| Existing Area | v4.1 Integration |
|---------------|------------------|
| `database/schema.sql` | Add v4.1 tables and constraints; preserve existing tables/triggers/state machine. |
| `api/src/routes/profile.ts` | Factor resume upload/text extraction into reusable source artifact ingestion. |
| `api/src/resume-parse.ts` | Reuse provider selection, PDF extraction, JSON parsing, and deterministic fallback patterns for evidence extraction. |
| `api/src/routes/jobs.ts` | Add match and evidence-usage reads without changing existing job/resume/QA responses incompatibly. |
| `agents/resume_tailor.py` | Accept ranked Vault evidence where available and record used IDs after resume version creation. |
| `agents/quality_analyst.py` | Keep existing QA score unchanged; explainable match score is a separate product assessment. |
| `frontend/app/lib/api.ts` | Add typed client methods for Vault, applications, contacts, reminders, and match explanations. |
| `frontend/app/lib/types.ts` | Add discriminated types for candidate states, application statuses, reminder statuses, and match buckets. |
| `frontend/app/routes/` | Add `vault`, `vault.review`, `applications`, `applications.$id`, `contacts`, and `jobs.$id.match` routes. |

## What Not To Add

- No new auth system.
- No multi-tenant user model.
- No separate worker queue.
- No Redis.
- No vector database or embedding service.
- No Elasticsearch/Meilisearch.
- No ORM migration.
- No email sending provider.
- No browser automation or auto-apply tooling.
- No LinkedIn/GitHub/browser-extension import in this milestone.
- No in-browser resume editor dependency.
- No separate CRM product integration.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Existing stack versions | HIGH | Verified from `api/package-lock.json`, `frontend/package-lock.json`, `pyproject.toml`, and `uv.lock` on 2026-06-22. |
| No new infrastructure | HIGH | Project requirements are single-user, self-hosted, evidence-first, and already have a working API/DB/agent pipeline. |
| Database-centered Vault model | HIGH | Provenance, approval state, application timelines, and resume evidence usage are relational and auditable. |
| Optional `.docx` support via Mammoth | MEDIUM | Useful for real resumes, but not required if v4.1 keeps accepted formats to PDF/Markdown/text. |
| Optional dnd-kit | MEDIUM | Good fit for accessible drag/drop Kanban, but the MVP can ship with buttons/selects first. |
| Avoid pgvector/semantic search | HIGH for v4.1 | Explainable scoring and small single-user datasets make transparent SQL/scoring preferable now. Revisit only after evidence volume or ranking quality demands it. |

## Sources

- Local: `.planning/PROJECT.md`, `.planning/STATE.md`, approved v4.1 design attachment.
- Local: `api/package.json`, `api/package-lock.json`, `frontend/package.json`, `frontend/package-lock.json`, `pyproject.toml`, `uv.lock`.
- Local: `database/schema.sql`, `database/007_discovery.sql`, `api/src/routes/jobs.ts`, `api/src/routes/profile.ts`, `api/src/resume-parse.ts`, `frontend/app/lib/api.ts`, `frontend/app/lib/types.ts`, `frontend/app/routes/_index.tsx`.
- PostgreSQL docs: `pg_trgm` provides trigram similarity and index support: https://www.postgresql.org/docs/current/pgtrgm.html
- PostgreSQL docs: GIN indexes are preferred for text search: https://www.postgresql.org/docs/current/textsearch-indexes.html
- Hono validation docs: https://hono.dev/docs/guides/validation
- React Router data loading docs: https://reactrouter.com/start/framework/data-loading
- PGlite extension docs: https://pglite.dev/extensions/
- dnd-kit official site: https://dndkit.com/
- react-beautiful-dnd archive/deprecation notice: https://github.com/atlassian/react-beautiful-dnd
- Mammoth npm package: https://www.npmjs.com/package/mammoth
