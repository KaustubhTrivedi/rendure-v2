# Roadmap: Rendure - v4.1 Job Search Operating System v1

## Historical Context

This active roadmap covers v4.1 only. Prior milestone history is preserved in `.planning/MILESTONES.md`.

Previous roadmap phase numbering reached Phase 10b. v4.1 continues with the next clear sequence: Phases 11-17.

## Overview

v4.1 turns Rendure from a URL-to-tailored-resume workflow into an evidence-backed job-search operating system. The milestone adds Career Vault, evidence import/review, Vault-assisted tailoring, application tracking, missing-achievement discovery, recruiter reminders, and explainable job-match scoring while preserving the existing tailoring pipeline and its compatibility contracts.

## Phases

**Phase Numbering:**
- Integer phases (11, 12, 13): Planned v4.1 milestone work
- Decimal phases (13.1, 13.2): Urgent insertions via `$gsd-phase --insert`

- [ ] **Phase 11: Architecture, Compatibility, and Migration Plan** - Lock compatibility, migration, privacy, and guardrail-test boundaries before adding new domains.
- [ ] **Phase 12: Career Vault Schema and API Foundation** - Establish approved Career Vault records, source artifacts, provenance, and approval-gated trusted writes.
- [ ] **Phase 13: Vault Import/Review UI and Tailoring Integration** - Let users approve imported evidence and let tailoring use only approved evidence with a resume-version ledger.
- [ ] **Phase 14: Application Tracker MVP** - Add user-controlled application records, workflow states, documents, timelines, board movement, and stale/follow-up indicators.
- [ ] **Phase 15: Missing Achievement Discovery** - Surface source-backed missing evidence candidates with add/use/reject actions.
- [ ] **Phase 16: Recruiter CRM Lite and Reminders** - Add reusable contacts, follow-up reminders, and grounded copy-only follow-up drafts.
- [ ] **Phase 17: Explainable Job-Match Score** - Add coarse, evidence-linked match assessments with limitations, confidence, and practical next actions.

## Phase Details

### Phase 11: Architecture, Compatibility, and Migration Plan
**Goal**: Existing users can keep using the URL-to-tailored-resume flow unchanged while v4.1 compatibility, migration, logging, and safety-test boundaries are established.
**Depends on**: Previous milestone baseline through Phase 10b sequence
**Requirements**: COMPAT-01, COMPAT-02, COMPAT-03, COMPAT-04, COMPAT-05, COMPAT-06, GUARD-06
**Success Criteria** (what must be TRUE):
  1. User can submit a job URL with no Vault setup and still complete Job Scout -> Resume Tailor -> Quality Analyst -> Confirmation.
  2. Existing API, SSE, resume Markdown, PDF, job detail, status, and QA report clients receive backward-compatible responses.
  3. New migrations are additive, leave `jobs.qa_score` and `jobs.iteration_count` trigger-owned, and keep application workflow status out of `jobs.status`.
  4. Pipeline audit events remain pipeline-only while private Vault, recruiter, and prompt content is redacted from logs unless required for a user-visible artifact.
  5. Automated guardrail tests cover no-Vault tailoring fallback, approval-gated evidence writes, source-required missing evidence, application status separation, no auto-apply, and no automatic email sending.
**Plans**: TBD

### Phase 12: Career Vault Schema and API Foundation
**Goal**: User has an approved Career Vault data foundation where source artifacts, profile preferences, roles, projects, achievements, skills, certifications, STAR stories, and provenance can be managed without allowing AI to create trusted evidence directly.
**Depends on**: Phase 11
**Requirements**: VAULT-01, VAULT-02, VAULT-03, VAULT-04, VAULT-05, VAULT-06, VAULT-07, VAULT-08, VAULT-09, GUARD-01, GUARD-02
**Success Criteria** (what must be TRUE):
  1. User can store career source artifacts with source type, source reference, extracted timestamp, approval state, and last user edit timestamp.
  2. User can maintain profile preferences plus approved roles, projects, achievements, normalized skills, certifications, and STAR stories with their required fields.
  3. Every approved Vault record preserves provenance to user-provided source artifacts or manual-entry metadata.
  4. AI extraction paths can create only untrusted candidates; trusted Career Vault records require an explicit user-initiated approval or manual-write path.
  5. Trusted Vault writes reject unsupported employers, roles, skills, projects, metrics, achievements, certifications, and interview stories rather than storing fabricated claims.
**Plans**: TBD

### Phase 13: Vault Import/Review UI and Tailoring Integration
**Goal**: User can import resume evidence, explicitly approve trusted Vault records, and generate tailored resumes that optionally use approved Vault evidence while recording exactly which evidence was used.
**Depends on**: Phase 12
**Requirements**: REVIEW-01, REVIEW-02, REVIEW-03, REVIEW-04, REVIEW-05, REVIEW-06, REVIEW-07, REVIEW-08, EVID-01, EVID-02, EVID-03, EVID-04, EVID-05, EVID-06, GUARD-03
**Success Criteria** (what must be TRUE):
  1. User can upload or select at least two resumes and review extracted untrusted candidates grouped for likely duplicates.
  2. User can edit, approve, merge, or reject candidates, with source provenance visible before approval or use.
  3. User can browse, search, manually create, and edit Vault records without running an import.
  4. URL-to-resume tailoring retrieves ranked approved evidence when available, uses no pending or rejected candidates, and still works when the Vault is empty or unavailable.
  5. Every generated resume version records validated used evidence IDs, and user can view which approved Vault evidence was used by that version.
**Plans**: TBD
**UI hint**: yes

### Phase 14: Application Tracker MVP
**Goal**: User can manage applications as a separate workflow from pipeline jobs, with durable status, documents, notes, JD snapshots, contacts, timeline events, and follow-up signals.
**Depends on**: Phase 13
**Requirements**: APP-01, APP-02, APP-03, APP-04, APP-05, APP-06, APP-07, APP-08, APP-09, APP-10, GUARD-04
**Success Criteria** (what must be TRUE):
  1. User can create an application manually, from a pasted job URL with immutable JD snapshot, or from an existing tailoring result in one or two actions.
  2. User can move applications across exactly saved, applied, interviewing, offer, rejected, and archived states on a Kanban or equivalent board without mutating pipeline `jobs.status`.
  3. User can attach generated resume versions and future cover-letter documents, then update notes, recruiter/contact details, and next follow-up dates.
  4. User can view an application detail page with JD snapshot, documents, notes, timeline, linked contacts, and linked Vault evidence; significant actions create timeline entries.
  5. Stale applications and overdue follow-up indicators are visible, and Rendure has no application-submission or browser-automation path.
**Plans**: TBD
**UI hint**: yes

### Phase 15: Missing Achievement Discovery
**Goal**: User can find source-backed evidence missing from an active resume and choose whether to add, use, or permanently reject each candidate without accepting AI-created claims.
**Depends on**: Phase 13
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06, DISC-07
**Success Criteria** (what must be TRUE):
  1. User can compare an active resume with approved user sources and view absent achievement, project, skill, or quantified-evidence candidates with precise source attribution.
  2. Missing-evidence candidates are grouped for likely duplicates and clearly labeled as evidence candidates, not AI-created claims.
  3. User can add a missing-evidence candidate to the Vault or use it in the active tailored resume only through an approved Vault evidence path.
  4. User can permanently reject a missing-evidence candidate so it does not repeatedly resurface.
**Plans**: TBD
**UI hint**: yes

### Phase 16: Recruiter CRM Lite and Reminders
**Goal**: User can track recruiter/contact relationships, manage follow-up reminders, and generate grounded copy-only follow-up drafts without Rendure sending email.
**Depends on**: Phase 14
**Requirements**: CRM-01, CRM-02, CRM-03, CRM-04, CRM-05, CRM-06, GUARD-05
**Success Criteria** (what must be TRUE):
  1. User can store recruiter/contact name, company, email, LinkedIn URL, last contact date, next follow-up date, and notes.
  2. User can link one contact to multiple applications and one application to multiple contacts.
  3. User can view a reminder queue for overdue and upcoming follow-ups, then snooze, dismiss, or complete a reminder.
  4. User can generate a concise follow-up draft grounded only in role, company, application status, known contact details, timeline events, and user notes; Rendure never sends email automatically.
**Plans**: TBD
**UI hint**: yes

### Phase 17: Explainable Job-Match Score
**Goal**: User can generate an auditable, coarse job-match assessment that explains fit with evidence links, hard constraints, confidence, top actions, and explicit limitations.
**Depends on**: Phase 13
**Requirements**: SCORE-01, SCORE-02, SCORE-03, SCORE-04, SCORE-05, SCORE-06, SCORE-07
**Success Criteria** (what must be TRUE):
  1. User can generate a job-match assessment that uses coarse fit buckets instead of false-precision ATS-style scoring.
  2. User can view dimension breakdowns for skills/responsibilities, seniority/scope, domain/stack, location/remote/visa/relocation constraints, and optional compensation when configured.
  3. Each match dimension shows supporting job-description evidence and Vault or resume evidence where available, and distinguishes missing evidence, missing demonstrated capability, hard logistical constraints, and low-confidence assessments.
  4. User receives the top three practical actions to improve or skip the application plus limitation copy that this is not an ATS score, recruiter-interest prediction, or interview-outcome prediction.
  5. Match assessments persist inputs, config version, dimension outputs, evidence links, confidence, and hard caps for auditability.
**Plans**: TBD
**UI hint**: yes

## Traceability

| Requirement Group | Phase |
|-------------------|-------|
| COMPAT-01 through COMPAT-06, GUARD-06 | Phase 11 |
| VAULT-01 through VAULT-09, GUARD-01, GUARD-02 | Phase 12 |
| REVIEW-01 through REVIEW-08, EVID-01 through EVID-06, GUARD-03 | Phase 13 |
| APP-01 through APP-10, GUARD-04 | Phase 14 |
| DISC-01 through DISC-07 | Phase 15 |
| CRM-01 through CRM-06, GUARD-05 | Phase 16 |
| SCORE-01 through SCORE-07 | Phase 17 |

**Coverage:** 65/65 v4.1 requirements mapped - 100%

## Progress

**Execution Order:**
Phases execute in roadmap order: 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 11. Architecture, Compatibility, and Migration Plan | 0/? | Not started | - |
| 12. Career Vault Schema and API Foundation | 0/? | Not started | - |
| 13. Vault Import/Review UI and Tailoring Integration | 0/? | Not started | - |
| 14. Application Tracker MVP | 0/? | Not started | - |
| 15. Missing Achievement Discovery | 0/? | Not started | - |
| 16. Recruiter CRM Lite and Reminders | 0/? | Not started | - |
| 17. Explainable Job-Match Score | 0/? | Not started | - |
