# Domain Pitfalls

**Domain:** Evidence-first job-search operating system added to an existing resume-tailoring app
**Project:** Rendure v4.1 Job Search Operating System v1
**Researched:** 2026-06-22
**Mode:** Pitfalls research
**Overall confidence:** HIGH for repository-specific integration risks, MEDIUM for product sequencing risks

## Scope

This document identifies common mistakes and concrete failure modes when adding Career Vault, application tracking, missing achievement discovery, recruiter CRM, explainable match scoring, interview prep, and internal competitive insights to the existing Rendure app.

The key theme is that this milestone adds a second source of truth: approved career evidence. Most serious failures come from letting unapproved AI output, old resume text, QA feedback, or tracker data masquerade as verified evidence.

## Critical Pitfalls

Mistakes that can cause fabrication, data corruption, broken tailoring, or a product rewrite.

### Pitfall 1: Treating AI-extracted candidates as trusted Vault evidence

**Category:** Provenance, AI safety, data modeling
**Phase to address:** Phase 2 - Career Vault schema, migration, APIs, and retrieval

**What goes wrong:** Resume ingestion extracts roles, projects, achievements, skills, certifications, or STAR stories and inserts them directly into trusted Vault tables. Tailoring, match scoring, interview prep, and missing-achievement discovery then reuse those records as if the user approved them.

**Why it happens:** The existing pipeline already persists LLM-derived job and resume data directly to `jobs`, `resume_versions`, and `qa_reviews`. Reusing that pattern for career evidence would violate the new milestone rule: nothing becomes trusted Vault evidence without explicit user approval.

**Consequences:**
- AI-fabricated or over-stretched claims become reusable career facts.
- Later features compound the error by generating resumes, scores, and interview stories from false evidence.
- The user loses trust because the Vault no longer means "verified by me."

**Warning signs:**
- Tables named `roles`, `achievements`, or `skills` receive rows from extraction jobs without an approval state.
- API endpoints named `/vault/import` or `/vault/extract` write directly to canonical Vault tables.
- Tailoring queries do not filter evidence by `approval_status = 'approved'`.

**Prevention:**
- Model extraction output as candidate records with `approval_status` and source links, not as trusted evidence.
- Require explicit user actions: approve, edit-and-approve, merge-and-approve, or reject.
- Enforce approved-only retrieval at the database/API layer, not just in prompts.
- Add migration tests proving unapproved candidates cannot be selected for tailoring, match scoring, or prep.

**Detection:** Add a regression test that imports a fabricated candidate achievement and confirms it is visible in review UI but unavailable to tailoring retrieval until approved.

### Pitfall 2: Losing source provenance when normalizing evidence

**Category:** Provenance, data modeling, UX
**Phase to address:** Phase 2 for schema, Phase 3 for review UI

**What goes wrong:** The system stores clean normalized achievements, roles, skills, and stories but loses the exact resume/upload/source artifact, extraction timestamp, user edit timestamp, and source span or excerpt that justified each record.

**Why it happens:** Normalized tables are easier to query than provenance graphs. Teams often store `source_type` as a plain string on the evidence row and call it done.

**Consequences:**
- Missing Achievement Discovery cannot show "where this came from."
- Resume versions cannot prove which Vault records were used.
- The user cannot audit or correct bad extraction decisions.
- Rejected candidates may be rediscovered repeatedly because there is no durable rejection tied to the source artifact.

**Warning signs:**
- Evidence tables have no join table to source artifacts.
- There is no way to represent one achievement supported by multiple resumes or documents.
- Rejections are deleted rather than stored as decisions.

**Prevention:**
- Create first-class `source_artifacts` and evidence-source link tables.
- Store extraction metadata separately from user approval metadata.
- Preserve rejected candidate records or rejection fingerprints so the same suggestion is not resurfaced blindly.
- In UI, show source title, type, date, and excerpt before approve/merge actions.

**Detection:** Test that a candidate achievement imported from two resumes can be merged into one approved achievement while preserving both source links.

### Pitfall 3: Failing to record evidence IDs used by generated resume versions

**Category:** Tailoring integration, auditability, schema
**Phase to address:** Phase 3 - Career Vault review/import UI and tailoring integration

**What goes wrong:** Resume Tailor uses Vault evidence in the prompt, but `resume_versions` only stores the generated `latex_source` and `tailoring_notes`. Later, the user cannot tell which achievements, skills, projects, or stories supported a tailored resume.

**Why it happens:** The current `agents/resume_tailor.py` writes only `job_id`, `version_number`, nullable git fields, `latex_source`, and notes. There is no `resume_version_evidence` join table.

**Consequences:**
- The milestone's non-negotiable evidence-use audit requirement is missed.
- Match score and application detail pages cannot explain what evidence supported the resume.
- QA cannot distinguish grounded tailoring from unsupported claims.

**Warning signs:**
- Tailoring retrieval returns raw text snippets instead of stable evidence IDs.
- Resume version API responses do not include evidence links.
- The Tailor prompt includes Vault content but DB writes do not persist a usage manifest.

**Prevention:**
- Add a join table from `resume_versions.version_id` to approved Vault evidence IDs with `usage_type` and optional generated resume section/bullet reference.
- Make the Resume Tailor return a structured usage manifest in addition to the resume text, then validate it against approved evidence rows before persisting.
- For backward compatibility, allow older resume versions to have no evidence links, but require new Vault-backed versions to record them.

**Detection:** Integration test: approved Vault achievement is selected for tailoring, generated resume version is inserted, and the evidence join table contains that achievement ID.

### Pitfall 4: Breaking the existing URL-to-tailored-resume flow while adding Vault dependencies

**Category:** Backward compatibility, roadmap sequencing
**Phase to address:** Phase 1 - Architecture and migration plan; regression tests every phase

**What goes wrong:** Tailoring starts requiring a populated Career Vault before the current job URL -> scrape -> tailor -> QA -> PDF flow can run. Users without a Vault, imported resumes, or approved evidence can no longer generate a resume.

**Why it happens:** The new product direction makes the Vault central, but the existing flow is load-bearing and must remain functional. `agents/resume_tailor.py` currently reads the base resume from `user_profile.resume_text` on iteration 1 and previous `resume_versions.latex_source` on retry.

**Consequences:**
- Existing users lose the primary value of Rendure.
- Self-hosted deployments break after migration.
- QA and PDF rendering routes continue to exist but no longer receive valid resume versions.

**Warning signs:**
- Resume Tailor raises "no approved Vault evidence" instead of falling back to profile/base resume.
- New database columns added to `resume_versions` are `NOT NULL` without backfill.
- API routes for existing jobs require application tracker or Vault state.

**Prevention:**
- Keep legacy tailoring as the default fallback until the user has approved Vault evidence.
- Make Vault-backed retrieval additive: prompt section present only when approved evidence exists.
- Add end-to-end regression tests for the pre-v4.1 flow before modifying Tailor or QA.
- Add migrations with nullable columns and backward-compatible API responses.

**Detection:** A clean database with only `user_profile.resume_text` should still pass a mocked full pipeline test and return resume Markdown/PDF through existing job routes.

### Pitfall 5: Letting prompts become the only anti-fabrication boundary

**Category:** AI safety, testing, agent design
**Phase to address:** Phase 3 for tailoring, Phase 5-8 for suggestion generators

**What goes wrong:** Prompts say "do not fabricate," but the system accepts LLM output without checking whether claims map to approved evidence. This is already a risk: `agents/resume_tailor.py` validates only that output is not too short, and `agents/quality_analyst.py` currently formats the QA prompt with hard-constraint checking disabled.

**Why it happens:** Prompt-only controls are cheaper to implement than structured claim validation. The Tailor outputs a whole resume as text/YAML, which makes evidence-level verification harder after generation.

**Consequences:**
- Unsupported skills, metrics, seniority claims, projects, or employers can enter resume versions.
- QA may pass a fluent but ungrounded resume.
- Interview prep may invent STAR stories if built on generated resume text instead of approved evidence.

**Warning signs:**
- The only guardrail is prompt text.
- QA hard constraints are loaded but not actually injected into the active prompt.
- Tests mock the LLM with compliant output only.

**Prevention:**
- Use structured intermediate outputs for selected evidence IDs and intended claims.
- Validate every selected claim against approved Vault evidence before allowing it into resume text or prep content.
- Re-enable and test hard-constraint checking in QA or replace it with deterministic evidence validation.
- Add adversarial tests where the LLM returns a plausible but unsupported skill or metric.

**Detection:** Unit test: mocked Tailor output includes an unsupported certification; validation rejects the version or records a high-severity constraint violation.

### Pitfall 6: Conflating application status with pipeline job status

**Category:** Data modeling, API, frontend UX
**Phase to address:** Phase 4 - Application Tracker schema, APIs, Kanban, and tailoring handoff

**What goes wrong:** The application tracker reuses `jobs.status` for user application state. Pipeline statuses like `tailoring`, `qa_review`, `approved`, and `low_match` get mixed with tracker statuses like `saved`, `applied`, `interviewing`, `offer`, `rejected`, and `archived`.

**Why it happens:** The existing `jobs` table already represents a job posting and has a status column. It is tempting to stretch it into an application tracker.

**Consequences:**
- The orchestrator state machine breaks.
- Kanban moves can put pipeline jobs into states not present in `allowed_transitions`.
- Existing `/jobs/:id/status` and SSE terminal logic become ambiguous.

**Warning signs:**
- New allowed transitions include tracker states.
- Kanban drag/drop updates the `jobs.status` column.
- Application UI queries directly from `jobs` instead of a separate application model.

**Prevention:**
- Create an `applications` table with its own status enum/check constraint and timeline.
- Link applications to `jobs.job_id` and `resume_versions.version_id` where applicable.
- Keep `jobs.status` strictly pipeline-owned.
- Treat "create application from tailoring result" as a handoff that inserts/updates `applications`, not as a pipeline status transition.

**Detection:** Test that moving an application to `applied` does not change the linked `jobs.status`.

### Pitfall 7: Turning `pipeline_events` into a general activity timeline

**Category:** Architecture, audit log design
**Phase to address:** Phase 4 for applications, Phase 6 for CRM

**What goes wrong:** Application notes, Kanban moves, recruiter reminders, and follow-up actions are stored in `pipeline_events`.

**Why it happens:** `pipeline_events` already powers SSE and has flexible `metadata`/`payload` JSONB fields. It is easy to reuse it as a generic timeline.

**Consequences:**
- SSE streams for jobs become noisy or leak unrelated application activity.
- Pipeline audit records are no longer a clean execution log.
- Contact and reminder history becomes coupled to pipeline deletion behavior.

**Warning signs:**
- `pipeline_events.event_type` starts including `application_note_added`, `followup_snoozed`, or `recruiter_contacted`.
- Application detail page queries `pipeline_events` for non-pipeline events.

**Prevention:**
- Add dedicated `application_timeline_events` or `application_activity` table.
- Keep `pipeline_events` for agent/orchestrator execution only.
- If an application is created from a job, store a timeline event that references the job and resume version, not a pipeline event.

**Detection:** API test that application activity appears on application detail but not in `/jobs/:id/events` SSE replay.

### Pitfall 8: Storing private resume/JD content in debug logs and prompt traces without retention boundaries

**Category:** Privacy, trust model, observability
**Phase to address:** Phase 1 and every agent-modifying phase

**What goes wrong:** The system logs full LLM prompts, including resumes, job descriptions, hard constraints, and later Vault evidence, into `pipeline_events.payload`. This is visible in current `resume_tailor.py` and `quality_analyst.py`.

**Why it happens:** Prompt traces are useful for debugging LLM failures, especially self-hosted. But once Vault and recruiter CRM exist, prompt payloads can contain the user's full career history and contact data.

**Consequences:**
- Sensitive evidence is duplicated into logs with unclear retention.
- Future export/delete flows miss private data inside JSON payloads.
- The self-hosted trust model is weakened because the app stores more private data than users expect.

**Warning signs:**
- `payload.prompt` includes full Vault evidence or recruiter notes.
- There is no config to disable prompt tracing.
- API exposes pipeline events with raw payloads.

**Prevention:**
- Introduce redacted prompt tracing: lengths, hashes, selected evidence IDs, and model metadata by default.
- Gate full prompt traces behind an explicit local debug flag.
- Never include raw private content in frontend-accessible event payloads unless needed for the user-facing feature.
- Add migration/cleanup plan for old prompt payloads if privacy posture changes.

**Detection:** Test prompt trace events for Vault-backed tailoring and verify raw resume/evidence text is absent by default.

### Pitfall 9: Adding explainable scoring as another opaque LLM score

**Category:** AI safety, product trust, testing
**Phase to address:** Phase 7 - Explainable Match Score

**What goes wrong:** Match scoring becomes a single LLM-generated number that claims to estimate ATS fit, recruiter interest, interview probability, or hiring odds.

**Why it happens:** The existing QA agent already computes a numeric pass/fail score and its prompt describes an "ATS audit system." Reusing that language for user-facing job-fit scoring would conflict with the v4.1 requirement for coarse, transparent, non-predictive buckets.

**Consequences:**
- False precision misleads the user.
- Scores are hard to test and hard to explain.
- The product drifts toward generic ATS-score tools, contrary to the approved design.

**Warning signs:**
- UI shows "87% ATS match" or "chance of interview."
- LLM returns final score directly.
- Score does not persist dimensions, caps, confidence, config, and supporting evidence.

**Prevention:**
- Implement deterministic scoring logic over extracted JD requirements and approved Vault/resume evidence.
- Use coarse buckets such as strong, promising, stretch, weak.
- Persist dimension breakdowns, hard caps, confidence, evidence links, and configuration.
- Include explicit limitation copy: not ATS prediction, not recruiter-interest prediction, not outcome prediction.
- Keep job-match score separate from QA pass/fail score.

**Detection:** Evaluation harness with representative candidate/JD pairs verifies hard logistical caps and repeatable bucket outputs.

### Pitfall 10: Building Missing Achievement Discovery before evidence import and approval are mature

**Category:** Roadmap sequencing, provenance, UX
**Phase to address:** Phase 5 - Missing Achievement Discovery

**What goes wrong:** Discovery compares generated resumes, unapproved extraction candidates, and old profile text, then proposes "missing achievements" without precise source attribution.

**Why it happens:** Missing-achievement discovery sounds like a standalone AI comparison feature, but it depends on approved source artifacts, durable rejection decisions, duplicate grouping, and evidence-source links.

**Consequences:**
- The system proposes claims with no user-verifiable source.
- Rejected suggestions return repeatedly.
- Users cannot distinguish "you forgot this" from "AI inferred this."

**Warning signs:**
- Discovery operates on free-form resume text only.
- Suggestions do not show source artifact and excerpt.
- There is no reject-permanently action.

**Prevention:**
- Do not start Phase 5 until Phase 2/3 source artifacts, approval states, and duplicate grouping exist.
- Label outputs as evidence candidates, not achievements.
- Require each suggestion to cite a source artifact and source excerpt.
- Store rejection decisions keyed to source artifact/fingerprint.

**Detection:** Integration test: absent achievement is suggested only when present in an approved source artifact; no-source candidates are blocked.

## Moderate Pitfalls

Mistakes that cause degraded UX, confusing data, or costly rework.

### Pitfall 11: Silently merging duplicates during Vault import

**Category:** Product UX, data modeling
**Phase to address:** Phase 2 and Phase 3

**What goes wrong:** The importer decides that two roles, projects, achievements, or skills are duplicates and merges them automatically.

**Why it happens:** Duplicate detection is necessary after importing multiple resumes. Automatic merging feels efficient but can collapse distinct roles, timeframes, metrics, or projects.

**Consequences:**
- Evidence becomes inaccurate before the user reviews it.
- Provenance becomes ambiguous.
- The user has to untangle merged records manually.

**Warning signs:**
- Import API has `dedupe=true` behavior that writes merged canonical records.
- Review UI shows only final merged output, not grouped candidates.

**Prevention:**
- Store duplicate groups as review suggestions.
- Let the user approve, split, edit, or merge.
- Preserve every original candidate and source link.
- Use deterministic fingerprints plus LLM-assisted similarity only for grouping hints.

**Detection:** Test two similar achievements with different metrics; importer groups them but does not merge them until user action.

### Pitfall 12: Modeling skills as ungoverned strings everywhere

**Category:** Data modeling, retrieval quality
**Phase to address:** Phase 2

**What goes wrong:** `React`, `React.js`, `reactjs`, `JS`, `JavaScript`, and framework names are stored as unrelated strings across jobs, Vault evidence, applications, and scores.

**Why it happens:** Existing `job_skills.skill` is a simple text primary key per job. That is adequate for scraped JD skills but weak for Vault retrieval and scoring.

**Consequences:**
- Retrieval misses relevant evidence.
- Match scores undercount known skills.
- Duplicate review UI becomes noisy.

**Warning signs:**
- New tables store skill arrays as JSONB when they need joins.
- There is no canonical skill table or alias mechanism.
- Skill matching is implemented with ad hoc lowercase string comparisons.

**Prevention:**
- Create a normalized skills table with aliases/categories where skills need to be queried.
- Keep source wording in provenance, but link to canonical skill IDs for retrieval.
- Add migration-safe bridges from existing `job_skills` text to canonical skills.

**Detection:** Test that a JD requiring `Kubernetes` matches approved evidence sourced as `k8s`.

### Pitfall 13: Overusing JSONB for core relational concepts

**Category:** Schema, API, frontend
**Phase to address:** Phase 2 and Phase 4

**What goes wrong:** Roles, projects, achievements, evidence links, application statuses, recruiter contacts, reminders, and timelines are stored as nested JSONB blobs.

**Why it happens:** JSONB is fast to add and flexible for AI output. The approved design, however, contains relationships that need filtering, linking, constraints, and timeline queries.

**Consequences:**
- Foreign keys cannot protect evidence links.
- Application Kanban queries become brittle.
- Frontend forms must patch nested blobs instead of small resources.
- PGlite/Postgres compatibility and migrations become harder to verify.

**Warning signs:**
- A single `vault_records` table has `record_type` and a giant `payload`.
- Application timeline is embedded in `applications.activity_json`.
- Resume evidence usage is a JSON array on `resume_versions`.

**Prevention:**
- Normalize entities that are browsed, linked, filtered, or independently edited.
- Reserve JSONB for generated analysis payloads, versioned extraction metadata, and flexible scoring config snapshots.
- Add explicit FKs, indexes, and delete behavior for relationships.

**Detection:** Migration tests enforce FK failure when a resume-version evidence link references a nonexistent evidence ID.

### Pitfall 14: Ignoring existing API response stability

**Category:** API compatibility, frontend integration
**Phase to address:** Phase 1 and every API phase

**What goes wrong:** Existing `/jobs`, `/jobs/:id`, `/jobs/:id/status`, `/jobs/:id/resumes`, `/jobs/:id/qa`, and `/jobs/:id/events` responses change shape to include Vault/application concepts or renamed fields.

**Why it happens:** It is tempting to "clean up" legacy names like `latex_source`, `jobs`, or QA dimensions while building the new model.

**Consequences:**
- Dashboard, resume viewer, QA report, PDF route, and Telegram/bot clients break.
- Backward compatibility promises fail.
- Test failures appear far from the migration that caused them.

**Warning signs:**
- Existing fields are renamed instead of added.
- Routes start returning nested application objects by default.
- `latex_source` is renamed in schema or API.

**Prevention:**
- Add new endpoints for Vault and applications.
- Extend existing responses only with optional additive fields.
- Keep `latex_source` as the stored source column unless a separate compatibility migration is planned.
- Document route contracts before implementation.

**Detection:** Snapshot or contract tests around current job route responses before adding new routes.

### Pitfall 15: Neglecting single-user ownership boundaries because the app is self-hosted

**Category:** API, future compatibility, trust model
**Phase to address:** Phase 2 and Phase 4

**What goes wrong:** New API routes assume one global user and omit ownership fields or boundary checks entirely.

**Why it happens:** Current `user_profile` is single-row with `id = 1`, and v4.1 preserves a single-user self-hosted model.

**Consequences:**
- Future cloud/browser targets or multi-user migration become harder.
- Imported evidence, applications, and recruiter contacts are difficult to partition later.
- Tests cannot express "this application cannot attach another user's evidence."

**Warning signs:**
- New tables have no `profile_id`, owner key, or equivalent boundary.
- API endpoints attach any `resume_version_id` to any application without checking relationships.

**Prevention:**
- Include owner/profile boundary columns even if constrained to the single existing profile.
- Validate that linked jobs, resume versions, applications, contacts, and evidence belong to the same owner boundary.
- Keep this enforcement in service/query helpers, not only UI.

**Detection:** API test rejects attaching an evidence record from a different synthetic profile/owner boundary.

### Pitfall 16: Letting recruiter CRM become an email automation system

**Category:** Product safety, API, UX
**Phase to address:** Phase 6 - Recruiter CRM Lite and reminders

**What goes wrong:** The app adds "send follow-up" or email integration shortcuts before the milestone's manual-send boundary is ready.

**Why it happens:** Reminder queues naturally lead to draft generation and then to sending. The approved design explicitly forbids automatic email sending.

**Consequences:**
- Users may send incorrect or unsupported claims.
- The app crosses into automation the milestone excluded.
- Trust and legal risk increase.

**Warning signs:**
- API route names include `/send`, `/email`, or SMTP/Gmail dependencies.
- Follow-up drafts are generated without showing source context.
- UI has a primary "Send" action.

**Prevention:**
- Store contacts, reminders, snoozes, dismissals, and draft text only.
- Provide copy/export actions, not send actions.
- Generate drafts only from role, company, application status, contact details, timeline events, and user notes.
- Show grounding context near the draft.

**Detection:** Tests assert no email-sending dependency or route exists in Phase 6.

### Pitfall 17: Making the Vault review UI too fast to approve bad evidence

**Category:** Frontend UX, AI safety
**Phase to address:** Phase 3

**What goes wrong:** The review screen optimizes for bulk approval but hides source excerpts, diffs, and confidence warnings. Users approve inaccurate evidence because the UI makes review feel like inbox clearing.

**Why it happens:** Importing multiple resumes creates many candidates, and bulk actions are attractive.

**Consequences:**
- The Vault becomes polluted with unverified or over-generalized evidence.
- Later features remain "grounded" technically but grounded in bad approvals.

**Warning signs:**
- "Approve all" appears before source details are visible.
- Candidate cards show polished generated summaries but not original source text.
- Low-confidence extraction looks visually identical to high-confidence extraction.

**Prevention:**
- Put source excerpt and approval state in the first viewport of each candidate review item.
- Require edit/merge decisions for low-confidence or conflicting candidates.
- Allow bulk actions only for low-risk entities such as exact duplicate skills, and still show source grouping.
- Keep rejected and edited states visible in review history.

**Detection:** UI tests verify candidates display source attribution and approval controls together.

### Pitfall 18: Building application tracker UI without timeline semantics

**Category:** Frontend UX, data modeling
**Phase to address:** Phase 4

**What goes wrong:** The Kanban board changes statuses, but notes, document attachments, recruiter details, stale flags, follow-up dates, and status history are not represented as a coherent timeline.

**Why it happens:** Kanban is the most visible tracker feature, so teams build columns first and defer detail history.

**Consequences:**
- Recruiter CRM has no reliable last-contact or follow-up context.
- Interview prep cannot reconstruct application history.
- Users cannot answer "what happened with this application?"

**Warning signs:**
- Application status updates overwrite `last_status_change` but do not append an activity event.
- Notes are a single text column with no history.
- Follow-up reminders are calculated from mutable fields only.

**Prevention:**
- Treat timeline events as a core tracker primitive, not a later enhancement.
- Status changes, notes, attachment changes, contact updates, reminder snoozes, and dismissals should create timeline entries.
- Keep the Kanban board a projection of application state.

**Detection:** Integration test moves application from saved to applied and verifies both current status and timeline event.

### Pitfall 19: Binding interview prep to generated resume text instead of approved evidence

**Category:** AI safety, provenance
**Phase to address:** Phase 8 - Prepare Me interview prep

**What goes wrong:** Interview prep creates STAR stories and behavioral answers from the tailored resume version alone.

**Why it happens:** The approved resume is already job-specific and easy to retrieve. But generated resume text can omit context, compress details, or contain errors that should not become interview stories.

**Consequences:**
- Interview prep invents narrative details around a bullet.
- The user rehearses unsupported stories.
- Source attribution is weak or absent.

**Warning signs:**
- Prep prompts include resume text but not Vault story/achievement IDs.
- Behavioral scaffolds do not show supporting Vault items.

**Prevention:**
- Generate prep from application, JD snapshot, tailored resume, and approved Vault evidence links.
- Require every behavioral scaffold to cite Vault stories, achievements, roles, or projects.
- Let users edit STAR scaffolds and store edits separately from source evidence.

**Detection:** Test that a behavioral answer cannot be generated for an achievement lacking approved Vault evidence.

### Pitfall 20: Adding phase-wide migrations without rollback-safe compatibility checks

**Category:** Migration, deployment
**Phase to address:** Phase 1 and every schema phase

**What goes wrong:** A migration adds required columns, changes existing constraints, or mutates old rows in a way that breaks running self-hosted deployments.

**Why it happens:** v4.1 adds many tables. Without a staged migration plan, implementation may modify `database/schema.sql` and old migrations directly or assume a fresh database.

**Consequences:**
- Existing users cannot run new code against old data.
- Browser/PGlite and self-hosted schema paths diverge.
- Rollback becomes unsafe because data shape changed in place.

**Warning signs:**
- Existing migrations are edited.
- New columns on existing tables are `NOT NULL` with no default/backfill strategy.
- Tests only initialize a fresh schema, not migrate an existing one.

**Prevention:**
- Use additive numbered migrations.
- Keep `database/schema.sql` current, but do not rewrite deployed migrations.
- Add migration tests from current v4.0/v4.1-pre schema to new schema.
- Backfill in separate, idempotent steps when needed.

**Detection:** CI runs migration tests against a database containing representative existing jobs, resume versions, QA reviews, and pipeline events.

## Minor Pitfalls

Lower-severity mistakes that still create friction or future cleanup.

### Pitfall 21: Naming confusion around `latex_source`, Markdown, and RenderCV YAML

**Category:** Developer experience, compatibility
**Phase to address:** Phase 1

**What goes wrong:** New contributors assume `resume_versions.latex_source` contains LaTeX, Markdown, or RenderCV YAML depending on which doc/prompt they read. Current code and docs are inconsistent: the schema calls it legacy, routes return `text/markdown`, and the Tailor prompt asks for RenderCV YAML.

**Prevention:** Do not rename the column during this milestone. Document exact payload expectations in one place, add validation tests for the current RenderCV format, and use neutral names in new APIs such as `source_text` while mapping to `latex_source` internally.

**Warning signs:** New migrations add `markdown_source` or `yaml_source` next to `latex_source` without a clear compatibility plan.

### Pitfall 22: Making Competitive Insights block user-facing foundations

**Category:** Roadmap sequencing
**Phase to address:** Phase 9 only, unless done in parallel without blocking

**What goes wrong:** Internal competitor matrices consume schema/UI bandwidth before Career Vault and Application Tracker are functional.

**Prevention:** Keep Phase 9 isolated. It should not share critical migrations, routes, or navigation dependencies with the user-facing flow.

**Warning signs:** Top-level navigation or database migrations for competitors land before application tracker or Vault review is usable.

### Pitfall 23: Showing too much scoring data and not enough action

**Category:** Frontend UX, product trust
**Phase to address:** Phase 7

**What goes wrong:** Explainable score screens show many dimensions, decimals, and raw evidence snippets but do not answer what the user should do next.

**Prevention:** Always show top three practical actions, coarse bucket, limiting factors, evidence used, and uncertainty. Keep raw dimension detail available but secondary.

**Warning signs:** Score UI resembles a QA debug report instead of a decision support view.

### Pitfall 24: Treating stale applications as a simple date calculation

**Category:** Tracker UX, CRM
**Phase to address:** Phase 4 and Phase 6

**What goes wrong:** The app flags every old application as stale without considering status, next follow-up date, recent timeline activity, or dismissed reminders.

**Prevention:** Calculate stale/overdue from application status, last meaningful activity, next follow-up date, and reminder state. Do not flag archived/rejected applications as overdue.

**Warning signs:** Rejected or archived cards show overdue follow-up warnings.

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|----------------|------------|
| Phase 1 - Architecture and migration plan | Underestimating doc/code drift around Git branches, DB-only resume storage, QA dimensions, and RenderCV format | Write an explicit compatibility matrix for current schema, agents, API routes, frontend routes, and docs before implementation |
| Phase 2 - Career Vault schema, migration, APIs, and retrieval | Trusted evidence and candidates are not separated | Use candidate tables/statuses plus approved-only retrieval constraints |
| Phase 2 | Provenance is represented as a flat string | Model source artifacts and many-to-many evidence-source links |
| Phase 2 | JSONB swallows relational data | Normalize roles, projects, achievements, skills, certifications, stories, applications, contacts, and evidence links where they need queries/FKs |
| Phase 3 - Vault review/import UI and tailoring integration | Vault evidence used in prompts is not recorded on resume versions | Add and test `resume_version_evidence` usage records |
| Phase 3 | Existing tailoring requires Vault data and breaks legacy flow | Keep profile/base resume fallback and make Vault retrieval additive |
| Phase 3 | UI encourages blind approval | Show source excerpts, confidence, conflicts, and approval state directly beside actions |
| Phase 4 - Application Tracker | Tracker state mutates `jobs.status` | Separate `applications.status` from pipeline status |
| Phase 4 | Kanban built before detail/timeline model | Build application timeline events as a core primitive |
| Phase 5 - Missing Achievement Discovery | Suggestions lack source attribution | Block suggestions without source artifact and excerpt |
| Phase 5 | Rejected suggestions reappear | Store durable rejection decisions/fingerprints |
| Phase 6 - Recruiter CRM Lite | Reminder/draft generation drifts into email sending | No send routes, no SMTP/Gmail dependency, copy/export only |
| Phase 6 | Drafts use unsupported claims | Ground drafts only in application, timeline, contact, and user notes |
| Phase 7 - Explainable Match Score | Reuses QA score or LLM-generated ATS score | Deterministic bucket scoring with evidence links, hard caps, and limitation copy |
| Phase 8 - Prepare Me | Interview stories are generated from resume text alone | Require approved Vault story/achievement evidence for behavioral scaffolds |
| Phase 9 - Competitive Insights | Internal tooling delays user-facing core | Isolate behind internal route/data model and schedule after core flows |

## Testing Pitfalls To Avoid

### Horizontal test planning instead of vertical TDD

The project requires vertical red-green-refactor. For v4.1, avoid writing all Vault tests first and then implementing a broad schema. Each behavior should land as a narrow slice: migration constraint, API endpoint, UI state, retrieval rule, then integration.

### Only testing happy-path LLM output

Mocked LLM responses must include unsupported claims, malformed structured output, duplicate evidence, missing source attribution, high-confidence false positives, and empty outputs. The outer boundary is the LLM call; internal validation should be exercised through public agent/service interfaces.

### Missing regression coverage for old pipeline

Every phase that touches schema, `resume_versions`, `jobs`, agent prompts, job routes, SSE, or PDF rendering needs a regression test for the existing tailoring path. This is not optional because the current flow is still the product's load-bearing path.

### Testing only fresh databases

Migration tests must start from representative existing data: jobs in multiple statuses, resume versions with null git fields, QA reviews, pipeline events with payloads, and a populated `user_profile`.

## Roadmap Implications

1. Phase 1 should produce a compatibility map and migration strategy before any feature code. The current docs and implementation already diverge on Git branches, resume storage, QA dimensions, and output format.
2. Phase 2 must establish source artifacts, candidate approval states, canonical evidence tables, skill normalization, and approved-only retrieval. Later phases depend on this.
3. Phase 3 should integrate Vault evidence into tailoring only after recording evidence usage is designed and tested. The legacy no-Vault path must stay green.
4. Phase 4 should model applications and timelines separately from pipeline jobs/events. Do not start with only a Kanban projection.
5. Phase 5 through Phase 8 must all consume approved Vault evidence and source links. If any of these features need unsupported free-form generation, stop and add evidence modeling first.
6. Phase 7 scoring should be deterministic and explainable. It should not modify QA pass/fail semantics or claim ATS/recruiter prediction.

## Sources Reviewed

- Approved v4.1 design source: `/Users/kaustubhtrivedi/.codex/attachments/e01e7152-f417-4224-85e3-129a934ead1b/pasted-text.txt`
- Project context: `.planning/PROJECT.md`
- Agent/project operating contract: `AGENTS.md`
- Current schema: `database/schema.sql`
- Current job API routes: `api/src/routes/jobs.ts`
- Current Resume Tailor: `agents/resume_tailor.py`
- Current Quality Analyst: `agents/quality_analyst.py`
- Repository graph summary: `graphify-out/wiki/index.md` or `graphify-out/GRAPH_REPORT.md`

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Product pitfalls | HIGH | Derived from the approved design's explicit non-negotiables and phase ordering |
| Data modeling pitfalls | HIGH | Grounded in current schema and required new relationships |
| Provenance pitfalls | HIGH | Central to the Career Vault, Missing Achievement Discovery, tailoring audit, and interview prep requirements |
| AI safety pitfalls | HIGH | Current Tailor/QA code shows prompt-only controls and disabled hard-constraint QA check risk |
| Migration/API pitfalls | HIGH | Existing job routes and schema have concrete backward-compatibility constraints |
| Frontend UX pitfalls | MEDIUM | Based on milestone requirements and current route behavior; detailed frontend code was not part of this read set |
| Testing pitfalls | HIGH | Project mandates TDD and existing flow regression protection |
