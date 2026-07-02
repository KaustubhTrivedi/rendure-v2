# Architecture Patterns

**Project:** Rendure v4.1 Job Search Operating System v1  
**Domain:** Evidence-backed job-search operating system on top of an existing resume-tailoring pipeline  
**Researched:** 2026-06-22  
**Confidence:** HIGH for current-code integration points; MEDIUM for exact table granularity until migration design is finalized

## Executive Recommendation

Integrate v4.1 as additive domain modules around the existing pipeline, not as a replacement for it. PostgreSQL remains the source of truth, `jobs` remains the tailoring pipeline state machine, `resume_versions` remains immutable generated-resume history, and `qa_reviews` remains the existing QA audit trail. Career Vault, Application Tracker, Recruiter CRM, Missing Achievement Discovery, and Explainable Match Score should each get their own schema boundary, API route group, and frontend route group.

The key architectural change is to make approved Career Vault evidence available to the existing Resume Tailor and to record which approved evidence influenced each generated resume version. Do this with a new retrieval layer and a new `resume_version_evidence` join table. Avoid adding Vault state directly to `jobs`, `qa_reviews`, or the current job status machine.

Application tracking should be a separate workflow from tailoring. A pipeline `job` can create or link to an `application`, but application statuses (`saved`, `applied`, `interviewing`, `offer`, `rejected`, `archived`) must not be added to `jobs.status`. This keeps SSE, Telegram, QA, PDF retrieval, and existing dashboard behavior compatible.

## Current Architecture Baseline

```text
React/Vite frontend
  -> Hono API, authenticated by X-API-Key
     -> PostgreSQL through api/src/db.ts and db-adapter.ts
     -> detached Python subprocesses through api/src/execution-adapter.ts
        -> run_agents.py
           -> orchestrator.py
              -> job_scout.py
              -> resume_tailor.py
              -> quality_analyst.py
              -> confirmation.py

PostgreSQL tables already load-bearing:
  jobs, job_skills, resume_versions, qa_reviews, pipeline_events,
  user_profile, search_preferences, discovered_jobs
```

Important live-code facts:

| Area | Current behavior to preserve |
|------|------------------------------|
| Pipeline launch | `POST /jobs` inserts `jobs.status='new'`, then `runPipeline(...)` spawns `uv run python run_agents.py <url> --job-id <id>` |
| Progress | Python agents write `pipeline_events`; Hono streams `/jobs/:id/events` through `LISTEN pipeline_events` |
| Resume storage | Tailored resumes are stored in `resume_versions.latex_source`; `git_branch` and `git_commit` are nullable |
| Resume retrieval | `GET /jobs/:id/resume/:version_id` and `/pdf` read from `resume_versions` |
| QA | `qa_reviews` is insert-only; `jobs.qa_score` is trigger-owned |
| Iterations | `jobs.iteration_count` is trigger-owned from `resume_versions` inserts |
| Discovery | `discovered_jobs` is staging only; approved discoveries enqueue normal `jobs` pipeline rows |
| Profile | `user_profile.id=1` stores profile settings, model config, API key, and current base resume text |

## Recommended Architecture

```text
                    +-----------------------------+
                    | Existing React frontend      |
                    | dashboard, jobs, discover    |
                    +---------------+-------------+
                                    |
                                    v
                    +-----------------------------+
                    | Existing Hono API            |
                    | /jobs, /profile, /discovery  |
                    |                             |
                    | New route groups:            |
                    | /vault                       |
                    | /applications                |
                    | /contacts                    |
                    | /followups                   |
                    | /match                       |
                    +---------------+-------------+
                                    |
                                    v
+-------------------+    +--------------------------+    +--------------------+
| Existing Python   |    | PostgreSQL source of     |    | New ephemeral      |
| pipeline agents   |<-->| truth and audit tables   |<-->| extraction/scoring |
|                   |    |                          |    | agents/services    |
| Modified:         |    | Existing unchanged core: |    |                    |
| resume_tailor.py  |    | jobs, resume_versions,   |    | career_vault_*     |
| quality_analyst.py|    | qa_reviews, events       |    | missing_*          |
| optional          |    |                          |    | match_score_*      |
+-------------------+    | New additive modules:    |    +--------------------+
                         | vault, applications,     |
                         | contacts, followups,     |
                         | match assessments        |
                         +--------------------------+
```

### Component Boundaries

| Component | New or modified | Responsibility | Communicates with |
|-----------|-----------------|----------------|-------------------|
| `database/008_career_vault.sql` | New | Source artifacts, candidate evidence, approved Vault entities, provenance, duplicate groups | API routes, extraction agent, Resume Tailor |
| `database/009_applications.sql` | New | Applications, application documents, notes, timeline events, JD snapshots | `/applications`, `/jobs` handoff |
| `database/010_crm_followups.sql` | New | Recruiter/contact records, contact links, reminders, draft metadata | `/contacts`, `/followups`, `/applications` |
| `database/011_match_scores.sql` | New | Match assessments, dimensions, evidence links, config used, confidence and caps | match service, job/application detail UI |
| `database/012_missing_evidence.sql` | New | Missing-achievement candidate queue and user actions | missing discovery service, Vault review UI |
| `api/src/routes/vault.ts` | New | Vault CRUD, imports, candidate review, merge/reject/approve | DB, extraction adapter |
| `api/src/routes/applications.ts` | New | Application CRUD, Kanban list, status changes, notes, documents, timeline | DB, jobs route for handoff |
| `api/src/routes/contacts.ts` | New | Recruiter/contact CRUD and links to applications | DB |
| `api/src/routes/followups.ts` | New | Due queue, snooze/dismiss, grounded draft generation | DB, LLM helper |
| `api/src/routes/match.ts` | New | Run/read explainable match assessments for jobs/applications | DB, deterministic scorer, optional LLM extraction |
| `api/src/index.ts` | Modified | Mount new route groups behind existing API-key middleware | Route modules |
| `api/src/execution-adapter.ts` | Modified | Add detached entry points for Vault extraction, missing discovery, and match scoring if implemented in Python | Python scripts |
| `agents/resume_tailor.py` | Modified | Retrieve approved Vault evidence, include it in prompt, persist `resume_version_evidence` | DB, LLM |
| `agents/quality_analyst.py` | Modified lightly | Optionally read `resume_version_evidence` for grounded constraint checks; keep writing existing `qa_reviews` fields unchanged | DB, LLM |
| `frontend/app/routes.ts` | Modified | Add Vault, Applications, Contacts/Followups, Match routes | Route components |
| `frontend/app/lib/api.ts` | Modified | Add typed clients for new route groups | Hono API |
| `frontend/app/lib/types.ts` | Modified | Add Vault/Application/Contact/Match types; keep existing job types stable | Frontend routes |
| `frontend/app/routes/jobs.$id.tsx` | Modified | Add "Create/Link application", Vault evidence, match score entry points | API |
| `frontend/app/components/Nav.tsx` | Modified | Add navigation for Vault and Applications | UI routes |

## Schema Boundaries

### Career Vault

Career Vault should be split into three layers:

1. Source artifacts: uploaded or selected source material.
2. Candidate evidence: AI-extracted, untrusted records awaiting user action.
3. Approved Vault entities: trusted, editable career evidence.

Recommended tables:

| Table | Purpose | Notes |
|-------|---------|-------|
| `vault_source_artifacts` | Stores uploaded/selected source text and metadata | `source_type`, `filename`, `content_text`, `content_hash`, `metadata`, `created_at` |
| `vault_import_runs` | One import batch, usually at least two resumes | Tracks status, source count, model used, error detail |
| `vault_evidence_candidates` | Untrusted extracted candidates | `entity_type`, `payload JSONB`, `approval_status`, `confidence`, `duplicate_group_id` |
| `vault_duplicate_groups` | Review buckets for likely duplicates | User chooses approve, merge, or reject |
| `career_roles` | Approved roles | Normalized because roles are linked by many other entities |
| `career_projects` | Approved projects | Optional FK to role |
| `career_achievements` | Approved resume-ready evidence statements | Linked to role/project and provenance |
| `career_skills` | Normalized skill names and categories | Unique normalized name |
| `career_certifications` | Approved credentials | Issue/expiry dates optional |
| `career_stories` | STAR stories | Situation/task/action/result fields |
| `career_evidence_sources` | Provenance join for every approved entity | Stores source artifact, candidate ID, source snippet/span, approval timestamp |
| `career_entity_skills` | Skill links for roles/projects/achievements/stories | Avoid duplicating skill arrays |
| `resume_version_evidence` | Evidence IDs used by a generated resume version | Required by v4.1 non-negotiable |

Do not overload `user_profile` with Vault entities. Keep `user_profile` for preferences and current base resume only.

### Application Tracker

Applications are durable workflow objects, separate from `jobs`.

| Table | Purpose | Notes |
|-------|---------|-------|
| `applications` | One tracked application | Nullable `job_id`; status check constraint with six required statuses |
| `application_documents` | Links resumes, cover letters, or external docs | `resume_version_id` nullable FK to `resume_versions` |
| `application_notes` | User notes | Append or editable notes; timeline logs edits separately |
| `application_timeline_events` | Audit trail | Status changes, document attachments, notes, reminders |
| `application_job_snapshots` | JD snapshot at save/apply time | Preserve even if source URL disappears |

`applications.job_id` should be nullable. Manual applications may never run tailoring. Tailoring jobs may never become applications.

### Recruiter CRM Lite

Keep contacts reusable across applications.

| Table | Purpose | Notes |
|-------|---------|-------|
| `contacts` | Recruiter/contact record | Name, company, email, LinkedIn URL, notes |
| `application_contacts` | Many-to-many link | Contact role, primary flag |
| `followup_reminders` | Follow-up queue | Due date, status (`open`, `snoozed`, `dismissed`, `done`) |
| `followup_drafts` | Generated but unsent drafts | Store prompt metadata and grounded source IDs, not email-send state |

Do not add email sending tables in v4.1. Drafts are text artifacts only.

### Explainable Match Score

This is not the same as existing QA score. QA evaluates a generated resume against a JD to decide pipeline pass/fail. Match score evaluates job fit using JD, approved Vault evidence, constraints, and optionally the active resume.

| Table | Purpose | Notes |
|-------|---------|-------|
| `match_assessments` | One assessment run | `job_id` or `application_id`, bucket, config JSONB, confidence |
| `match_dimensions` | Per-dimension scores and caps | Skills, seniority, domain/stack, logistics, optional compensation |
| `match_evidence_links` | Supporting and contradicting evidence | Links JD snippets, Vault evidence IDs, resume version IDs |
| `match_actions` | Top recommended actions | Max three user-facing actions |

Use coarse buckets in persisted data: `strong`, `good`, `mixed`, `weak`, `blocked`, plus confidence. Store numeric internals only as diagnostic details if needed.

### Missing Achievement Discovery

Missing discovery produces candidates, not trusted claims.

| Table | Purpose | Notes |
|-------|---------|-------|
| `missing_evidence_candidates` | Evidence present in approved sources but absent from active resume | Has `status`: `pending`, `added_to_vault`, `used_in_resume`, `rejected` |
| `missing_evidence_candidate_sources` | Exact source attribution | Required source artifact, snippet/span, optional Vault entity |
| `missing_evidence_actions` | Audit of add/use/reject | Who/when/action and target IDs |

## Data Flow Changes

### 1. Career Vault Import and Approval

```text
Frontend /vault/import
  -> POST /vault/sources or POST /vault/imports
     -> store vault_source_artifacts
     -> spawn extraction run or call extraction service
        -> write vault_evidence_candidates only
        -> group duplicates into vault_duplicate_groups
        -> write audit event

Frontend /vault/review
  -> GET /vault/candidates?status=pending
  -> user approve/edit/merge/reject
     -> approval route writes approved career_* rows
     -> writes career_evidence_sources provenance
     -> updates candidate status
```

Rule: extraction never writes approved evidence directly. Approval routes are the only trusted-evidence write path.

### 2. Vault-Backed Tailoring

```text
Existing POST /jobs or discovery approve
  -> existing run_agents.py pipeline
     -> Job Scout writes JD as today
     -> Resume Tailor reads:
        - jobs row
        - previous qa_reviews on retry
        - user_profile.resume_text or prior resume version
        - approved ranked Vault evidence
     -> Resume Tailor prompt includes evidence IDs and provenance summaries
     -> model returns resume source plus used evidence IDs
     -> agent validates IDs are approved and in offered set
     -> INSERT resume_versions as today
     -> INSERT resume_version_evidence rows
     -> jobs.status -> qa_review as today
```

Recommended implementation detail: change the Resume Tailor LLM response to structured JSON:

```json
{
  "resume_source": "cv:\n  ...",
  "used_evidence_ids": ["..."],
  "tailoring_notes": "..."
}
```

Only `resume_source` goes into `resume_versions.latex_source`. If the model returns old raw YAML, keep a fallback parser that stores the resume and records zero evidence IDs with a `pipeline_events` warning during the transition. That preserves old behavior while tests are added.

### 3. Tailoring Result to Application

```text
Approved or low_match job detail
  -> POST /applications/from-job
     body: { job_id, resume_version_id?, initial_status? }
  -> creates applications row
  -> stores JD snapshot from jobs.jd_text
  -> attaches resume_versions row in application_documents
  -> writes application_timeline_events
```

Do not automatically create applications for every tailoring job. The user must initiate save/track.

### 4. Manual or URL Application Creation

```text
Manual:
  POST /applications
    -> applications row with status='saved'
    -> optional JD snapshot and contact

URL:
  POST /applications/from-url
    -> best-effort extraction using existing job-scout/Jina path or a lightweight extraction helper
    -> applications row
    -> optional jobs row only if user chooses to tailor
```

The tracker must not require a `jobs` row. Otherwise the app becomes unable to track roles the user applied to outside Rendure.

### 5. Missing Achievement Discovery

```text
User selects active resume or application
  -> POST /vault/missing-evidence/run
     -> compare active resume text with approved Vault evidence and source artifacts
     -> write missing_evidence_candidates with source attribution
  -> user add/use/reject
     -> add: approval path creates/links Vault entity
     -> use: creates a tailoring request or marks evidence for next tailoring pass
     -> reject: candidate stays rejected for audit/dedup suppression
```

This should run after Vault approval and resume-version evidence links exist. Otherwise "missing" cannot be explained reliably.

### 6. Recruiter CRM and Follow-up Drafts

```text
Application detail
  -> add/link contact
  -> set next_followup_date
  -> followup_reminders row

Follow-up queue
  -> GET /followups?status=open&due=...
  -> POST /followups/:id/draft
     -> reads application, contact, notes, timeline only
     -> returns/stores draft
     -> never sends email
```

Draft prompt inputs must be assembled from structured application data. Do not allow the model to invent recruiter history.

### 7. Explainable Match Score

```text
Job detail or application detail
  -> POST /match/assessments
     -> deterministic extraction of dimensions from JD, preferences, Vault evidence, active resume
     -> optional LLM normalization for JD responsibilities only
     -> hard caps for logistics and missing evidence
     -> persist bucket, dimensions, evidence links, top actions, limitations
  -> GET /match/assessments/:id
```

This should not feed `jobs.qa_score`. Existing QA score remains a pipeline quality gate.

## API Route Shape

### Existing Routes to Keep Stable

| Route | Compatibility requirement |
|-------|---------------------------|
| `POST /jobs` | Same request body and response shape |
| `GET /jobs` | Existing fields remain; new application link fields can be additive only |
| `GET /jobs/:id` | Existing `qa_review` and `pipeline_events` shape remains |
| `GET /jobs/:id/events` | No new terminal statuses; still closes on `approved`, `low_match`, `error` |
| `GET /jobs/:id/resumes` | Existing summary shape remains |
| `GET /jobs/:id/resume/:version_id` | Still returns markdown/YAML source text |
| `GET /jobs/:id/resume/:version_id/pdf` | Still renders from `resume_versions.latex_source` |
| `GET/PUT /discovery/*` | Discovery staging behavior remains |
| `GET/PATCH /profile` | Profile remains preferences, not the Vault |

### New Route Groups

| Route | Purpose |
|-------|---------|
| `POST /vault/imports` | Create import run from two or more selected/uploaded sources |
| `GET /vault/imports/:id` | Import status and candidate counts |
| `POST /vault/sources` | Upload or register source artifact |
| `GET /vault/sources` | List source artifacts |
| `GET /vault/candidates` | Review queue, filter by status/entity type/group |
| `POST /vault/candidates/:id/approve` | Approve one candidate after optional edits |
| `POST /vault/duplicate-groups/:id/merge` | Merge duplicate candidates into one approved entity |
| `POST /vault/candidates/:id/reject` | Reject candidate |
| `GET /vault/roles`, `/vault/projects`, `/vault/achievements`, `/vault/skills`, `/vault/certifications`, `/vault/stories` | Browse/search approved Vault entities |
| `POST/PATCH/DELETE /vault/<entity>` | Manual create/edit/archive trusted records |
| `GET /vault/evidence/:type/:id/sources` | Provenance for an approved entity |
| `POST /vault/missing-evidence/run` | Start missing-evidence discovery |
| `GET /vault/missing-evidence` | Candidate queue |
| `POST /vault/missing-evidence/:id/add-to-vault` | Convert candidate through approval path |
| `POST /vault/missing-evidence/:id/use-in-resume` | Mark for tailoring or create tailoring request |
| `POST /vault/missing-evidence/:id/reject` | Reject with audit |
| `GET /applications` | Kanban list with filters and stale/overdue indicators |
| `POST /applications` | Manual application create |
| `POST /applications/from-job` | Create application from tailoring result |
| `POST /applications/from-url` | Create saved application from URL with best-effort extraction |
| `GET /applications/:id` | Detail with JD snapshot, docs, contacts, notes, timeline |
| `PATCH /applications/:id` | Edit core fields |
| `POST /applications/:id/status` | Status transition plus timeline event |
| `POST /applications/:id/documents` | Attach resume/cover letter/link |
| `POST /applications/:id/notes` | Add note |
| `GET/POST/PATCH /contacts` | Recruiter/contact CRUD |
| `POST /applications/:id/contacts` | Link contact to application |
| `GET /followups` | Due/upcoming queue |
| `POST /followups/:id/snooze` | Snooze reminder |
| `POST /followups/:id/dismiss` | Dismiss reminder |
| `POST /followups/:id/draft` | Generate grounded draft without sending |
| `POST /match/assessments` | Run assessment for job/application |
| `GET /match/assessments/:id` | Explainable score detail |

Mount these in `api/src/index.ts` behind `apiKeyMiddleware()` just like `/jobs`, `/profile`, and `/discovery`.

## UI Route Shape

Recommended additions to `frontend/app/routes.ts`:

```ts
route("vault", "routes/vault.tsx")
route("vault/import", "routes/vault.import.tsx")
route("vault/review", "routes/vault.review.tsx")
route("vault/:entity/:id", "routes/vault.$entity.$id.tsx")
route("applications", "routes/applications.tsx")
route("applications/:id", "routes/applications.$id.tsx")
route("contacts", "routes/contacts.tsx")
route("followups", "routes/followups.tsx")
route("jobs/:id/match/:assessmentId", "routes/jobs.$id_.match.$assessmentId.tsx")
route("applications/:id/match/:assessmentId", "routes/applications.$id_.match.$assessmentId.tsx")
```

Modify existing routes:

| Existing route | Change |
|----------------|--------|
| `_index.tsx` | Add tracker summary and Vault readiness, but keep current job dashboard primary actions |
| `discover.tsx` | Add "Save application" or "Tailor and track" actions after discovery approval |
| `jobs.$id.tsx` | Add application handoff, evidence-used panel, and match-score entry point |
| `jobs.$id_.resume.$vid.tsx` | Show Vault evidence used by this version if present |
| `jobs.$id_.qa.$rid.tsx` | Keep QA report semantics; do not rename it to match score |
| `settings.tsx` | Keep model/profile configuration; link to Vault import instead of expanding settings into Vault CRUD |
| `Nav.tsx` | Add `Vault` and `Applications`; optionally `Follow-ups` after CRM phase |

## Agent Integration Points

### Resume Tailor

Modify `agents/resume_tailor.py` in the smallest safe way:

1. Add a helper that reads approved Vault evidence relevant to the job:
   - required skills from `jobs.required_skills`
   - responsibilities and role title from `jobs.jd_text`
   - approved roles/projects/achievements/stories with provenance
2. Rank deterministically first using keyword overlap and role/project links.
3. Include only top bounded evidence in the LLM prompt with stable evidence IDs.
4. Require the LLM to report `used_evidence_ids`.
5. Validate every used ID is from the offered approved set.
6. Insert `resume_versions` as today.
7. Insert `resume_version_evidence` rows in the same transaction.
8. Write a `pipeline_events` row with counts only, not raw private evidence text.

Backward-compatible fallback: if no approved Vault evidence exists, `resume_tailor.py` should behave exactly as today using `user_profile.resume_text` or the prior resume version.

### Quality Analyst

Do not rewrite QA into match scoring. Keep its pass/fail loop intact.

Recommended light changes:

1. Add optional provenance awareness: read `resume_version_evidence` and source summaries for the current version.
2. Use this to improve constraint-violation checks.
3. Keep `qa_reviews` insert shape unchanged.
4. Keep `jobs.status` transitions unchanged.

If new diagnostic dimensions are needed, store them in `pipeline_events.payload` or a new auxiliary table. Do not add required columns to `qa_reviews` unless the existing frontend and tests are updated in the same phase.

### New Extraction and Scoring Work

Prefer new ephemeral agents or pure service modules:

| Work | Recommended implementation |
|------|----------------------------|
| Resume evidence ingestion | New `agents/career_vault_extractor.py` or TS service called from `/vault/imports`; writes candidates only |
| Duplicate grouping | Deterministic normalization plus optional LLM explanation; output to `vault_duplicate_groups` |
| Missing achievement discovery | New service/agent after Vault exists; writes candidate queue only |
| Match scoring | Deterministic TypeScript or Python service with optional LLM JD normalization; persists config and evidence links |
| Follow-up draft generation | API-side LLM helper is enough; no pipeline integration needed |

Use the existing provider configuration from `user_profile` and existing encrypted API-key flow. Do not create another credential store.

## Patterns to Follow

### Pattern 1: Additive Sidecar Tables

**What:** New domains link to existing pipeline rows by nullable FKs or join tables.

```sql
-- Conceptual example
CREATE TABLE resume_version_evidence (
  version_id UUID NOT NULL REFERENCES resume_versions(version_id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  evidence_id UUID NOT NULL,
  usage_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (version_id, evidence_type, evidence_id)
);
```

**Why:** Existing API clients keep working, while new features can explain provenance.

### Pattern 2: Candidate Before Trusted Record

**What:** LLM extraction writes untrusted candidate rows. User approval creates trusted Vault rows.

**Why:** It enforces the milestone rule that AI cannot create trusted claims on its own.

### Pattern 3: Separate Pipeline Audit from Application Timeline

**What:** Keep `pipeline_events` for agent/pipeline execution. Use `application_timeline_events` for user workflow history.

**Why:** Pipeline SSE and Telegram depend on terminal pipeline semantics. Application lifecycle has different statuses and should not pollute that stream.

### Pattern 4: Explain with Evidence Links, Not Narrative Alone

**What:** Match scores, missing achievements, and drafts must store links to source artifacts, Vault entities, resume versions, or JD snippets.

**Why:** This keeps UI explanations auditable and prevents ungrounded claims from becoming product output.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Adding Application Statuses to `jobs.status`

**Why bad:** It breaks the pipeline state machine, SSE terminal logic, Telegram notifications, and retry behavior.  
**Instead:** Use `applications.status` and `application_timeline_events`.

### Anti-Pattern 2: Writing Approved Vault Evidence from an Extractor

**Why bad:** It violates the non-negotiable approval gate.  
**Instead:** Extractors write `vault_evidence_candidates`; approval routes write trusted `career_*` tables.

### Anti-Pattern 3: Reusing `qa_score` as Job-Match Score

**Why bad:** QA score answers "is this generated resume good enough?" Match score answers "how well does this role fit my evidence and constraints?"  
**Instead:** Create `match_assessments` and display it separately.

### Anti-Pattern 4: Storing Provenance Only in JSON Blobs

**Why bad:** The roadmap needs querying, filtering, joins, and UI evidence panels. JSON-only provenance becomes hard to audit.  
**Instead:** Use relational provenance joins plus JSONB for flexible extraction payloads.

### Anti-Pattern 5: Expanding Settings into the Vault

**Why bad:** `user_profile` is already busy with preferences, API keys, and base resume text.  
**Instead:** Build first-class Vault routes and tables.

## Build Order

1. **Architecture and migrations plan**
   - Finalize table names, FK behavior, indexes, route contracts, and migration ordering.
   - Add tests that existing `/jobs`, `/jobs/:id/events`, resume retrieval, and QA routes still pass before new feature work.

2. **Career Vault schema and API foundation**
   - Add source artifacts, import runs, candidates, duplicate groups, approved entity tables, provenance joins.
   - Add `/vault` APIs and tests.
   - No tailoring changes yet.

3. **Career Vault import/review UI**
   - Add `/vault/import`, `/vault/review`, browse/edit pages.
   - Implement approve/edit/merge/reject.
   - This must be done before Tailor consumes Vault evidence.

4. **Vault-backed tailoring integration**
   - Add ranked retrieval helper.
   - Modify `resume_tailor.py`.
   - Add `resume_version_evidence`.
   - Show evidence used on job/resume detail pages.
   - Regression-test old no-Vault tailoring path.

5. **Application Tracker MVP**
   - Add applications schema/API/Kanban/detail pages.
   - Add `POST /applications/from-job` and job detail handoff.
   - Tracker depends on stable job/resume IDs but not on CRM.

6. **Missing Achievement Discovery**
   - Now that approved Vault evidence and resume-version evidence links exist, compare active resumes to approved sources.
   - Add missing-evidence queue and actions.

7. **Recruiter CRM Lite and reminders**
   - Add contacts, application-contact links, follow-up reminders, draft generation.
   - Depends on applications.

8. **Explainable Match Score**
   - Add assessment tables, scoring config, evidence links, and UI.
   - Depends on approved Vault evidence and ideally application records for workflow context.

9. **Prepare Me and Competitive Insights**
   - Out of immediate question scope, but should come after Vault + applications + evidence links are stable.

## Migration Strategy

Use additive numbered migrations after `database/007_discovery.sql`. Do not edit existing deployed migrations. Update `database/schema.sql` only after each migration is created and tested, keeping it as the full current schema snapshot.

Recommended order:

| Migration | Content |
|-----------|---------|
| `008_career_vault.sql` | Vault sources, candidates, approved entities, provenance, skill joins |
| `009_resume_version_evidence.sql` | Join generated resume versions to approved evidence |
| `010_applications.sql` | Applications, docs, notes, timeline, JD snapshots |
| `011_contacts_followups.sql` | Contacts, application contacts, reminders, drafts |
| `012_missing_evidence.sql` | Missing evidence candidates, sources, actions |
| `013_match_assessments.sql` | Match assessments, dimensions, evidence links, actions |

Indexes to include:

- `vault_evidence_candidates(approval_status, entity_type)`
- `vault_evidence_candidates(duplicate_group_id)`
- `career_skills(normalized_name)` unique
- `career_evidence_sources(entity_type, entity_id)`
- `resume_version_evidence(version_id)`
- `applications(status, last_status_change_at)`
- `applications(job_id)`
- `application_timeline_events(application_id, created_at DESC)`
- `followup_reminders(status, due_at)`
- `match_assessments(job_id, created_at DESC)`
- `match_assessments(application_id, created_at DESC)`

Deletion behavior:

- Deleting a source artifact should be restricted if approved evidence depends on it, or soft-delete only.
- Deleting a Vault entity should be soft-delete/archive once it has been used by a resume version.
- Deleting a job should cascade existing resume/QA as today, and should set application links to null or restrict deletion depending on current product behavior. Prefer `ON DELETE SET NULL` for `applications.job_id`.
- `resume_version_evidence` can cascade with `resume_versions`.

## Backward Compatibility Requirements

| Existing behavior | Required compatibility approach |
|-------------------|----------------------------------|
| URL-to-resume flow | Works with zero Vault records; Tailor falls back to current profile resume behavior |
| Existing jobs list/detail | Existing response fields unchanged; additive fields only |
| SSE | No new `jobs.status` values; no application statuses in pipeline events terminal logic |
| PDF rendering | Continue rendering from `resume_versions.latex_source`; do not require Vault to render |
| QA reports | Keep `qa_reviews` response shape; match score is separate |
| Discovery | Discovery approval still queues `jobs`; optional "save application" is additive |
| Telegram | Existing terminal notifications remain tied to `approved`, `low_match`, `error` |
| Single-user model | New tables can omit user FK for now or use `profile_id=1`, but route code should keep ownership checks centralized for future migration |

## Audit and Provenance

Use three separate audit/provenance mechanisms:

| Mechanism | Scope | Examples |
|-----------|-------|----------|
| `pipeline_events` | Agent execution and pipeline progress | Vault evidence count offered to Tailor, Tailor evidence IDs accepted, QA pass/fail |
| `career_evidence_sources` | Why a Vault claim is trusted | Resume source, source snippet/span, candidate record, approval time |
| `application_timeline_events` | User application workflow | Status changed, note added, contact linked, reminder snoozed |

Do not store raw full resumes or full JDs in event payloads. Store IDs, counts, hashes, snippets where necessary, and structured metadata.

## Scalability Considerations

| Concern | Single-user self-hosted | Later cloud/browser target | Recommended design now |
|---------|--------------------------|----------------------------|------------------------|
| Vault search | SQL `ILIKE`, JSONB filters, indexes are enough | May need full-text search or embeddings | Start with Postgres full-text compatible columns; avoid hard dependency on external vector DB |
| Extraction runs | Detached subprocess is enough | Queue worker needed | Keep execution behind `execution-adapter.ts` |
| Evidence ranking | Deterministic keyword overlap enough for v1 | Embeddings may improve recall | Implement ranking as replaceable helper with tests |
| Application board | Simple SQL by status | Pagination/filtering needed | API accepts filters from the start |
| Match scoring | Synchronous or short background task | Background task for expensive scoring | Persist assessment runs and config |
| Provenance | Relational joins | Same model scales | Do not hide provenance in unqueryable blobs |

## Test Strategy for Roadmap Phases

| Phase | Required tests |
|-------|----------------|
| Vault schema/API | Migration constraints, candidate cannot become approved without approval route, provenance required |
| Vault UI | Import/review flows, approve/edit/reject states, duplicate group actions |
| Tailoring integration | No-Vault regression, approved-evidence retrieval, invalid evidence IDs rejected, `resume_version_evidence` written |
| Applications | Manual create, from-job create, status transition timeline, stale/overdue indicators |
| Missing discovery | Candidate has source attribution, reject suppresses repeat, add-to-vault uses approval path |
| CRM/followups | Due queue, snooze/dismiss, draft uses only application/contact/timeline data |
| Match score | Hard caps, bucket calculation, evidence links, top actions max three, limitations shown |

## Open Design Questions

- Whether Vault extraction should be implemented first as a Python ephemeral agent or a TypeScript API service. Either works; choose Python if reusing agent prompt/testing patterns is faster, TypeScript if keeping upload/import UX synchronous is simpler.
- Whether approved Vault entities should use one polymorphic `career_evidence` table or separate typed tables. Recommendation: separate typed tables for roles/projects/achievements/skills/certifications/stories, with shared provenance joins.
- Whether `source_artifacts.content_text` should store full text or a normalized extract plus file hash. For self-hosted single-user, full text is acceptable; for browser/cloud targets, document storage policy before enabling imports.
- Whether match scoring runs automatically on job approval/application creation or only by user action. Recommendation: user-triggered first, then cache latest assessment.

## Sources

- `.planning/PROJECT.md` - milestone goals, constraints, current architecture, build order
- `/Users/kaustubhtrivedi/.codex/attachments/e01e7152-f417-4224-85e3-129a934ead1b/pasted-text.txt` - approved v4.1 design source
- `database/schema.sql` - current source-of-truth pipeline schema
- `database/007_discovery.sql` - current discovery staging schema
- `api/src/index.ts` - route mounting and API-key route protection
- `api/src/routes/jobs.ts` - job, SSE, QA, resume, PDF route contracts
- `api/src/routes/discovery.ts` - discovery approval and pipeline handoff
- `api/src/routes/profile.ts` - profile, API key, and resume upload baseline
- `api/src/execution-adapter.ts` - detached subprocess integration seam
- `agents/resume_tailor.py` - current tailoring data reads/writes and prompt boundary
- `agents/quality_analyst.py` - current QA scoring and status transitions
- `frontend/app/routes.ts` - current frontend route registry
- `frontend/app/lib/api.ts` - current frontend API client shape
- `frontend/app/lib/types.ts` - current frontend type contracts
