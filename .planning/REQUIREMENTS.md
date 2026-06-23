# Requirements: Rendure v4.1 Job Search Operating System v1

**Defined:** 2026-06-22
**Core Value:** A job seeker pastes a URL and gets back a tailored, high-quality resume without touching a single line of their resume themselves.

## v4.1 Requirements

### Vault Data Model

- [ ] **VAULT-01**: User can store career source artifacts with source type, source reference, extracted timestamp, approval state, and last user edit timestamp.
- [ ] **VAULT-02**: User can maintain a profile and career preferences including headline, summary, preferred titles, location, work authorization, remote/hybrid, and relocation preferences.
- [ ] **VAULT-03**: User can maintain approved roles with company, title, employment type, dates, location, level, and description.
- [ ] **VAULT-04**: User can maintain approved projects with title, optional linked role, timeframe, domain, technology stack, description, and outcomes.
- [ ] **VAULT-05**: User can maintain approved achievements with resume-ready evidence statements, optional role/project links, quantified metrics when present, related skills, and source artifacts.
- [ ] **VAULT-06**: User can maintain approved normalized skills with category values such as language, framework, cloud, tooling, domain, and soft skill.
- [ ] **VAULT-07**: User can maintain approved certifications with name, issuer, issue date, and expiry date.
- [ ] **VAULT-08**: User can maintain approved STAR stories with title, situation, task, action, result, tags, and links to roles, projects, and achievements.
- [ ] **VAULT-09**: Every approved Vault record preserves provenance to one or more user-provided source artifacts or manual-entry metadata.

### Vault Review Workflow

- [ ] **REVIEW-01**: User can upload or select at least two existing resumes as import sources for Career Vault extraction.
- [ ] **REVIEW-02**: Rendure extracts candidate roles, projects, achievements, skills, certifications, and STAR stories into untrusted candidate records.
- [ ] **REVIEW-03**: Rendure groups likely duplicate candidates for review instead of silently merging them.
- [ ] **REVIEW-04**: User can approve a candidate into trusted Vault evidence only through an explicit approval action.
- [ ] **REVIEW-05**: User can edit candidate content before approval while preserving the original source provenance.
- [ ] **REVIEW-06**: User can merge duplicate candidates into one approved Vault record while preserving all selected source provenance.
- [ ] **REVIEW-07**: User can reject candidates so rejected evidence does not become trusted Vault data.
- [ ] **REVIEW-08**: User can browse, search, manually create, and edit Vault records without running an import.

### Evidence Retrieval and Usage

- [ ] **EVID-01**: Resume tailoring can retrieve ranked approved Vault evidence relevant to a target job description.
- [ ] **EVID-02**: Resume tailoring continues to work when the Vault is empty or unavailable.
- [ ] **EVID-03**: Resume tailoring only receives approved Vault evidence, never pending or rejected candidates.
- [ ] **EVID-04**: Every generated resume version records the approved Vault evidence IDs that were used.
- [ ] **EVID-05**: User can view which Vault evidence was used by a generated resume version.
- [ ] **EVID-06**: Rendure validates Tailor-selected evidence IDs against the approved evidence offered for that tailoring run.

### Existing Flow Compatibility

- [ ] **COMPAT-01**: Existing job URL submission still creates a pipeline job and runs Job Scout, Resume Tailor, Quality Analyst, and Confirmation without requiring Vault setup.
- [ ] **COMPAT-02**: Existing job detail, status, SSE events, resume Markdown retrieval, PDF retrieval, and QA report routes remain backward compatible.
- [ ] **COMPAT-03**: New migrations are additive and do not write directly to trigger-owned `jobs.qa_score` or `jobs.iteration_count`.
- [ ] **COMPAT-04**: Application workflow status does not reuse or mutate pipeline-owned `jobs.status`.
- [ ] **COMPAT-05**: Pipeline events remain pipeline audit records; application activity uses a separate timeline.
- [ ] **COMPAT-06**: Logs and audit events avoid storing full private Vault, recruiter, or prompt content unless explicitly required for a user-visible artifact.

### Application Workflow

- [ ] **APP-01**: User can create an application manually with company, role title, location, employment type, source, URL, notes, status, and optional recruiter/contact details.
- [ ] **APP-02**: User can create an application from a pasted job URL with best-effort job extraction and an immutable JD snapshot.
- [ ] **APP-03**: User can create an application from an existing tailoring result in one or two actions.
- [ ] **APP-04**: Applications support exactly the statuses saved, applied, interviewing, offer, rejected, and archived.
- [ ] **APP-05**: User can attach generated resume versions and future cover-letter documents to an application.
- [ ] **APP-06**: User can move applications across a Kanban or equivalent status board.
- [ ] **APP-07**: User can update application notes, recruiter/contact details, and next follow-up dates.
- [ ] **APP-08**: User can view an application detail page with JD snapshot, documents, notes, timeline, linked contacts, and linked Vault evidence.
- [ ] **APP-09**: Rendure shows stale applications and overdue follow-up indicators.
- [ ] **APP-10**: Every significant application action writes an auditable application timeline entry.

### Discovery and Gap Analysis

- [ ] **DISC-01**: User can compare an active resume with other approved user sources to find evidence absent from the active resume.
- [ ] **DISC-02**: Rendure identifies candidate achievements, projects, skills, or quantified evidence only when backed by precise user-provided source attribution.
- [ ] **DISC-03**: Rendure groups likely duplicate missing-evidence candidates before presenting them to the user.
- [ ] **DISC-04**: User can add a missing-evidence candidate to the Vault.
- [ ] **DISC-05**: User can use a missing-evidence candidate in the active tailored resume through an approved Vault evidence path.
- [ ] **DISC-06**: User can reject a missing-evidence candidate permanently so it does not repeatedly resurface.
- [ ] **DISC-07**: Missing-evidence suggestions are clearly labeled as evidence candidates, not AI-created claims.

### CRM and Reminders

- [ ] **CRM-01**: User can store recruiter/contact name, company, email, LinkedIn URL, last contact date, next follow-up date, and notes.
- [ ] **CRM-02**: User can link one contact to multiple applications and one application to multiple contacts.
- [ ] **CRM-03**: User can view a reminder queue for overdue and upcoming follow-ups.
- [ ] **CRM-04**: User can snooze, dismiss, or complete a follow-up reminder.
- [ ] **CRM-05**: User can generate a concise follow-up draft grounded only in the role, company, application status, known contact details, timeline events, and user notes.
- [ ] **CRM-06**: Follow-up drafts are copy-only artifacts; Rendure does not send email automatically.

### Explainable Scoring

- [ ] **SCORE-01**: User can generate a job-match assessment that uses coarse fit buckets instead of false-precision ATS-style scoring.
- [ ] **SCORE-02**: Match assessments show dimension breakdowns for skills/responsibilities, seniority/scope, domain/stack, location/remote/visa/relocation constraints, and optional compensation when configured.
- [ ] **SCORE-03**: Each match dimension shows supporting job-description evidence and Vault or resume evidence where available.
- [ ] **SCORE-04**: Match assessments distinguish missing evidence, missing demonstrated capability, hard logistical constraints, and low-confidence assessments.
- [ ] **SCORE-05**: Match assessments provide the top three practical actions to improve or skip the application.
- [ ] **SCORE-06**: Match assessments include limitation copy stating the score is not an ATS score, recruiter-interest prediction, or interview-outcome prediction.
- [ ] **SCORE-07**: Match scoring persists inputs, config version, dimension outputs, evidence links, confidence, and hard caps for auditability.

### Guardrails and Auditability

- [ ] **GUARD-01**: AI extraction may create candidates but cannot write trusted Career Vault evidence directly.
- [ ] **GUARD-02**: Rendure never fabricates employers, roles, skills, projects, metrics, achievements, certifications, or interview stories.
- [ ] **GUARD-03**: User-visible AI suggestions show source provenance before approval or use.
- [ ] **GUARD-04**: Rendure never submits applications or performs browser automation.
- [ ] **GUARD-05**: Rendure never sends recruiter email automatically.
- [ ] **GUARD-06**: Automated tests cover no-Vault tailoring fallback, approval-gated evidence writes, source-required missing evidence, application status separation, and no-send/no-auto-apply boundaries.

## Future Requirements

### Imports

- **IMPORT-01**: User can import career evidence automatically from LinkedIn.
- **IMPORT-02**: User can import career evidence automatically from GitHub or portfolio sites.
- **IMPORT-03**: User can use a browser extension to capture jobs or career evidence.
- **IMPORT-04**: User can parse email/inbox updates into application timeline events.

### Collaboration

- **COLLAB-01**: Multiple users can collaborate on a shared job-search workspace.
- **COLLAB-02**: User can share selected applications or Vault evidence with another reviewer.

### Automation

- **AUTO-01**: User can connect an email provider for monitored replies after explicit consent.
- **AUTO-02**: User can export structured application packets for external tools.

### Interview Prep

- **PREP-01**: User can generate interview preparation briefs grounded in approved Vault evidence and application context.
- **PREP-02**: User can generate role-specific STAR story practice prompts from approved stories and achievements.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatic LinkedIn, GitHub, browser-extension, or email import | Explicitly excluded from this milestone; schema should leave room for later importers. |
| Team sharing or multi-user collaboration | Rendure remains a single-user self-hosted product in v4.1. |
| Performance-review or promotion-management workflows | Not part of job-search operating-system scope. |
| Autonomous trusted evidence writes | Violates the evidence-first approval model. |
| Auto-apply or browser automation | The user must remain in control of applications. |
| Automatic recruiter email sending | CRM Lite supports reminders and copy-only drafts, not email sending. |
| ATS, recruiter-interest, or interview-outcome prediction | Explainable scoring is a decision aid, not a hiring outcome prediction. |
| New auth, ORM, queue, vector database, or search infrastructure | Research found no required new infrastructure for core v4.1. |
| Resume WYSIWYG editor as the main workflow | Users edit Vault evidence and review generated resumes; the existing tailoring flow remains primary. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|

**Coverage:**
- v4.1 requirements: 65 total
- Mapped to phases: 0
- Unmapped: 65

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-22 after v4.1 requirements definition*
