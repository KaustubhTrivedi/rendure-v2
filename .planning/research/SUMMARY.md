# Project Research Summary

**Project:** Rendure v4.1 - Job Search Operating System v1
**Domain:** Single-user, self-hosted evidence-backed job-search operating system built around an existing resume-tailoring pipeline
**Researched:** 2026-06-22
**Confidence:** HIGH

## Executive Summary

Rendure v4.1 should turn the current URL-to-tailored-resume product into a job-search operating system by adding an approved Career Vault, application tracking, recruiter reminders, missing-achievement discovery, and explainable match scoring around the existing pipeline. The current Hono API, React Router frontend, PostgreSQL schema, Python agents, and DB-backed pipeline are load-bearing and should be extended additively, not replaced.

The recommended approach is evidence-first: AI extraction may create candidate records from user-provided resumes and source artifacts, but no career fact becomes trusted until the user explicitly approves, edits, merges, or rejects it. Once approved evidence exists, the Resume Tailor can retrieve ranked evidence for a JD, include stable evidence IDs in its prompt, and record exactly which evidence IDs were used by every new resume version. If the Vault is empty, the current tailoring flow must still work from `user_profile.resume_text` / prior `resume_versions.latex_source`.

The key risks are fabrication, provenance loss, and accidental coupling to the existing pipeline state machine. Mitigate them with separate candidate and approved-evidence tables, relational provenance joins, a required `resume_version_evidence` ledger, dedicated `applications.status` instead of reusing `jobs.status`, copy-only follow-up drafts, deterministic match buckets with evidence links, and regression tests proving the pre-v4.1 URL-to-resume flow still works.

## Key Findings

### Recommended Stack

Keep the current stack. v4.1 needs schema, route, agent/helper, and UI additions; it does not need new infrastructure. PostgreSQL remains the source of truth, Hono remains the API framework, React Router remains the frontend routing layer, and Python agents continue to handle pipeline work. Use raw parameterized SQL and the existing DB adapter boundary rather than adding an ORM.

**Core technologies:**
- PostgreSQL migrations: Career Vault, application, CRM, match, and missing-evidence tables with CHECK constraints and FK-backed provenance.
- Hono + `pg` + Zod: `/vault`, `/applications`, `/contacts`, `/followups`, and `/match` route groups using existing validation/error patterns.
- React 19 + React Router 7: Vault review, application board/detail, follow-up queue, and match explanation routes under the existing frontend structure.
- Python 3.12 agents + psycopg2: additive retrieval/extraction/scoring helpers while preserving DB-mediated agent state.
- Vitest and pytest: route, schema mapper, migration, retrieval, scoring, and agent integration tests.

**Stack additions:** none required for core v4.1. Add `mammoth` only if `.docx` resume ingestion is explicitly included. Add `@dnd-kit/*` only after a non-drag Kanban board works and true drag/drop is required.

**Stack non-additions:** no new auth system, queue, Redis, ORM, vector database, search engine, document DB, email provider, browser automation, auto-apply tooling, or separate CRM integration. Prefer transparent SQL and deterministic scoring over opaque embeddings for this milestone.

### Expected Features

**Must have (table stakes):**
- Career Vault data model for source artifacts, candidates, approved roles/projects/achievements/skills/certifications/STAR stories, provenance, and approval state.
- Resume import/extraction from at least two user-provided resumes into candidates, not trusted records.
- Vault review workflow with source excerpts, duplicate grouping, approve/edit/merge/reject, and manual create/edit.
- Approved-only evidence retrieval for a JD and a resume-version evidence ledger.
- Application tracker with manual create, create from URL, create from tailoring result, JD snapshot, statuses, documents, notes, timeline, stale/overdue indicators.
- Recruiter CRM Lite with contacts, application-contact links, follow-up reminders, snooze/dismiss, and grounded copy-only drafts.
- Missing Achievement Discovery with sourced candidates, confidence, add/use/reject actions, and permanent rejection memory.
- Explainable match score with coarse buckets, dimension breakdowns, hard caps, evidence links, top actions, and limitation copy.

**Should have (differentiators):**
- Evidence-first Vault with explicit user approval gates.
- Provenance-first missing achievement discovery from approved user material.
- Tailoring evidence ledger visible on job/resume detail pages.
- Application detail as the command center, richer than the board.
- Grounded follow-up drafts from application timeline and notes.
- Decision-oriented match actions instead of false-precision ATS-style scores.

**Defer:**
- Auto-apply, browser automation, application autofill, or autonomous submission.
- Automatic email sending, inbox parsing, sequences, or CRM analytics.
- LinkedIn/GitHub/browser-extension imports.
- Team sharing, multi-user collaboration, billing, or admin dashboards.
- Resume WYSIWYG/editor as the core workflow.
- ATS prediction, recruiter-interest prediction, or interview-probability claims.

### Architecture Approach

v4.1 should be implemented as additive domain modules around the existing pipeline. `jobs`, `resume_versions`, `qa_reviews`, `pipeline_events`, triggers, SSE, Telegram notifications, resume retrieval, and QA semantics remain stable. Career Vault, applications, contacts/followups, match assessments, and missing-evidence discovery each get separate schema boundaries, route groups, and frontend routes.

**Major components:**
1. Career Vault schema and APIs - source artifacts, untrusted candidates, duplicate groups, approved evidence, provenance joins, and approved-only retrieval.
2. Resume Tailor integration - ranked Vault evidence is optional input; new versions record approved evidence IDs in `resume_version_evidence`.
3. Application Tracker - separate `applications` workflow with status, documents, JD snapshots, notes, and timeline events.
4. Recruiter CRM Lite - reusable contacts, application-contact links, reminders, and grounded draft artifacts without send state.
5. Explainable Match Score - separate `match_assessments`, dimensions, evidence links, caps, actions, and limitation copy; do not reuse `qa_score`.
6. Missing Achievement Discovery - candidate queue sourced from approved evidence/source artifacts with durable rejection decisions.

**Integration points to preserve:**
- `POST /jobs`, `GET /jobs/:id`, `/events`, `/resumes`, `/resume/:version_id`, `/pdf`, `/profile`, and `/discovery` remain backward compatible.
- `pipeline_events` stays pipeline-only; application activity gets its own timeline table.
- `jobs.status` remains orchestrator/pipeline-owned; application lifecycle uses `applications.status`.
- `resume_versions.latex_source` remains the compatibility column even though it stores resume source text.

### Critical Pitfalls

1. **AI candidates become trusted evidence** - prevent by storing extraction output as candidates only and making approval routes the only trusted write path.
2. **Provenance is lost during normalization** - prevent with first-class source artifacts and many-to-many evidence-source joins, not flat strings or JSON-only provenance.
3. **Tailoring uses Vault evidence but does not record IDs** - prevent with a required `resume_version_evidence` join table and structured Tailor output containing `used_evidence_ids`.
4. **Existing URL-to-resume flow breaks** - prevent by keeping Vault retrieval optional, adding nullable/backward-compatible schema, and regression-testing the no-Vault path.
5. **Prompts are the only anti-fabrication boundary** - prevent by validating selected evidence IDs against approved offered evidence and adding adversarial tests for unsupported claims.
6. **Application status is conflated with pipeline status** - prevent with separate application tables, status constraints, and timeline events.
7. **Match score becomes opaque ATS theater** - prevent with deterministic buckets, dimensions, hard caps, evidence links, confidence, and explicit limitation copy.
8. **CRM drifts into email automation** - prevent by excluding send routes/dependencies and offering copy/export drafts only after user review.

## Implications for Roadmap

### Phase 1: Architecture, Compatibility, and Migration Plan
**Rationale:** The milestone touches schema, agents, API, frontend, and privacy-sensitive data. Lock boundaries before implementation so new domains do not corrupt pipeline semantics.
**Delivers:** Table/route contracts, migration order, compatibility matrix, regression tests for existing jobs/events/resume/QA routes, and privacy/logging rules for prompt traces.
**Addresses:** Additive architecture, existing tailoring flow compatibility, no production rewrite.
**Avoids:** Breaking `/jobs`, overloading `jobs.status`, risky migrations, prompt-log privacy leaks.

### Phase 2: Career Vault Schema and API Foundation
**Rationale:** Every evidence-backed feature depends on source artifacts, candidates, approval state, approved entities, and provenance.
**Delivers:** Vault migrations, `/vault/sources`, `/vault/imports`, `/vault/candidates`, approved record browse/search APIs, canonical skill/alias handling, approved-only retrieval primitives.
**Addresses:** Vault Data Model, Vault Review Workflow backend, Evidence Retrieval foundations.
**Avoids:** Trusted writes from extractors, JSONB-only modeling, ungoverned skill strings, provenance loss.

### Phase 3: Vault Import/Review UI and Tailoring Integration
**Rationale:** The Vault is only useful when users can approve evidence and the existing Tailor can use it without making Vault mandatory.
**Delivers:** `/vault/import`, `/vault/review`, duplicate grouping UI, approve/edit/merge/reject, evidence browse/edit, ranked retrieval in `resume_tailor.py`, `resume_version_evidence`, evidence-used panels.
**Addresses:** Resume evidence ingestion, explicit approval before trusted evidence, existing tailoring compatibility.
**Avoids:** Blind approval, unrecorded evidence use, prompt-only fabrication controls, no-Vault regression.

### Phase 4: Application Tracker MVP
**Rationale:** Once a resume run exists, the user needs durable workflow state that is separate from the pipeline.
**Delivers:** `applications`, documents, JD snapshots, notes, timeline events, manual/from-URL/from-job creation, Kanban/list view, detail page, stale and overdue indicators.
**Addresses:** Application Workflow and Application Workflow UI.
**Avoids:** Mutating `jobs.status`, using `pipeline_events` as a general activity log, board-only UX without timeline semantics.

### Phase 5: Missing Achievement Discovery
**Rationale:** Discovery is trustworthy only after approved evidence, source artifacts, duplicate handling, and evidence ledgers exist.
**Delivers:** Missing-evidence candidate runs, source excerpts, confidence, add-to-Vault/use-in-resume/reject actions, rejection fingerprints.
**Addresses:** Discovery and Gap Analysis.
**Avoids:** No-source suggestions, repeated rejected suggestions, AI-inferred achievements.

### Phase 6: Recruiter CRM Lite and Reminders
**Rationale:** CRM value depends on applications, contacts, timeline context, and follow-up dates.
**Delivers:** Contacts, application-contact links, follow-up reminders, due queue, snooze/dismiss/complete, grounded copy-only draft generation.
**Addresses:** CRM and Reminders.
**Avoids:** Email sending, unsupported draft context, full CRM scope creep.

### Phase 7: Explainable Job-Match Score
**Rationale:** Match scoring needs approved evidence, JD data, preferences, hard caps, and evidence links to avoid generic ATS-score behavior.
**Delivers:** `match_assessments`, dimensions, evidence links, scoring config/version, coarse buckets, hard caps, confidence, top three actions, UI limitation copy, evaluation fixtures.
**Addresses:** Explainable Scoring and Guardrails.
**Avoids:** Reusing QA score, LLM-only scoring, false precision, recruiter/ATS outcome claims.

### Phase Ordering Rationale

- Career Vault schema and approval must precede tailoring integration, missing discovery, and match scoring because approved evidence is the trust boundary.
- Tailoring integration should ship immediately after review/import because otherwise the Vault is disconnected from Rendure's core value.
- Application tracking can follow tailoring because it links jobs, resume versions, and JD snapshots but must stay independent from Vault availability.
- CRM follows applications because reminders and drafts need application status, contacts, notes, and timeline.
- Match score is late because it requires stable evidence retrieval, preferences/caps, and a small evaluation harness.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** migration compatibility and privacy/log retention audit against the current live schema and prompt-event payloads.
- **Phase 2:** exact table granularity, FK/delete behavior, canonical skill alias strategy, and PGlite compatibility for new migrations.
- **Phase 3:** structured Tailor output migration strategy and validation of evidence IDs without breaking legacy output parsing.
- **Phase 5:** similarity/dedupe and source-span strategy for missing evidence.
- **Phase 7:** deterministic scoring weights, hard-cap rules, and representative evaluation fixtures.

Phases with standard patterns:
- **Phase 4:** CRUD, Kanban/list projections, detail pages, document links, and timeline events are straightforward once schema contracts are fixed.
- **Phase 6:** contacts, reminders, snooze/dismiss, and copy-only drafts are standard; the main requirement is scope discipline.

## Requirement Categories Recommended for Next GSD Step

- **Vault Data Model:** source artifacts, import runs, candidates, duplicate groups, approved entities, provenance, canonical skills, ownership/profile boundary.
- **Vault Review Workflow:** candidate list, source excerpts, confidence, approve/edit/merge/reject, manual create/edit, rejection history.
- **Evidence Retrieval and Usage:** approved-only ranking, Tailor prompt integration, structured `used_evidence_ids`, `resume_version_evidence`, evidence-used UI.
- **Existing Flow Compatibility:** no-Vault fallback, existing route contracts, pipeline status machine, resume retrieval/PDF, QA loop, migration tests.
- **Application Workflow:** application records, statuses, JD snapshots, documents, notes, timeline, stale/overdue rules, from-job handoff.
- **CRM and Reminders:** contacts, application links, follow-up queue, snooze/dismiss/complete, grounded draft constraints, no-send boundary.
- **Discovery and Gap Analysis:** source-backed candidates, add/use/reject actions, rejection memory, duplicate grouping.
- **Explainable Scoring:** buckets, dimensions, hard caps, evidence links, confidence, top actions, limitation copy, eval harness.
- **Guardrails and Auditability:** no fabrication, explicit user approval, provenance display, redacted logs, immutable audit/event separation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Research verified current Hono, React Router, PostgreSQL, Python, Vitest, and pytest stack locally; no new infrastructure is justified for single-user v4.1. |
| Features | HIGH | Table stakes align with approved v4.1 design and market patterns, with project-specific constraints around approval, provenance, and no automation. |
| Architecture | HIGH | Integration points are grounded in current `jobs`, `resume_versions`, `qa_reviews`, `pipeline_events`, API routes, frontend routes, and agent behavior. Exact table granularity remains a planning task. |
| Pitfalls | HIGH | Critical risks are repository-specific and tied to known current behavior: DB-only resume storage, trigger-owned fields, pipeline SSE, prompt logging, and Tailor output shape. |

**Overall confidence:** HIGH

### Gaps to Address

- **Exact schema shape:** Decide final table names, FK strategy, indexes, status values, profile ownership columns, and migration order in Phase 1/2 planning.
- **Resume source format drift:** Reconcile `latex_source`, Markdown, and RenderCV/YAML expectations without renaming compatibility columns.
- **Evidence validation depth:** Define the first practical validator for unsupported Tailor claims; start with offered/approved evidence ID validation and adversarial tests.
- **Prompt/event privacy:** Audit current `pipeline_events` payloads before adding Vault evidence or recruiter data to prompts; default to redacted traces.
- **Scoring calibration:** Define match bucket thresholds, hard caps, and fixtures from real examples during Phase 7.
- **Optional dependencies:** Decide `.docx` and drag/drop only inside the relevant phase, not globally.

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` - current milestone goals, non-negotiables, constraints, validated existing features, and out-of-scope boundaries.
- `.planning/research/STACK.md` - verified stack versions, recommended additions/non-additions, integration points.
- `.planning/research/FEATURES.md` - table stakes, differentiators, anti-features, dependencies, and suggested phase mapping.
- `.planning/research/ARCHITECTURE.md` - additive schema/API/frontend/agent boundaries, data flows, route shapes, build order.
- `.planning/research/PITFALLS.md` - critical/moderate/minor pitfalls and phase-specific mitigations.
- Local code references cited by research: `database/schema.sql`, `api/src/routes/jobs.ts`, `api/src/routes/profile.ts`, `api/src/resume-parse.ts`, `frontend/app/lib/api.ts`, `frontend/app/lib/types.ts`, `agents/resume_tailor.py`, `agents/quality_analyst.py`.

### Secondary (MEDIUM confidence)
- PostgreSQL docs for GIN text search and `pg_trgm` as later performance options.
- Hono validation docs and React Router data-loading docs for route implementation patterns.
- PGlite extension docs for schema portability considerations.
- dnd-kit and Mammoth package docs for optional phase-scoped dependencies.

### Market/Ecosystem (MEDIUM confidence)
- Teal, Huntr, Jobscan, Resume Worded, and Simplify research cited in `FEATURES.md` for tracker, source-resume, contact, and match-score market patterns.

---
*Research completed: 2026-06-22*
*Ready for roadmap: yes*
