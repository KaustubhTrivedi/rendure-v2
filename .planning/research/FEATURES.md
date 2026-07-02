# Feature Landscape

**Domain:** Single-user, self-hosted job-search operating system
**Project:** Rendure v4.1 - Job Search Operating System v1
**Researched:** 2026-06-22
**Research mode:** Ecosystem - feature taxonomy and sequencing for new v4.1 capabilities only
**Overall confidence:** HIGH for tracker/CRM/match-score patterns; MEDIUM for Missing Achievement Discovery because the market pattern exists mostly as resume-gap analysis rather than evidence-provenance workflows.

---

## Context

Rendure already has the URL-to-tailored-resume pipeline: scrape JD, tailor resume, QA score, store run in Postgres, dashboard, discovery review, resume Markdown/PDF retrieval, and QA report views. This research intentionally does not re-spec those features.

v4.1 should turn the existing pipeline into an evidence-backed operating system:

```text
Approved career evidence
  -> ranked evidence retrieval for a target JD
  -> tailored resume/version
  -> saved application
  -> follow-up and contact management
  -> transparent match assessment and next actions
```

The main product decision is that **Career Vault is not a resume editor**. It is the trusted evidence store behind tailoring, match scoring, missing-achievement discovery, interview prep, and future exports. Existing competitors commonly keep a comprehensive resume/profile as a source document, then let users tailor each job-specific version from that source. Rendure should adopt the source-of-truth pattern, but with a stricter user-approval and provenance model than generic AI resume builders.

Non-negotiable constraints for every feature:

- No auto-apply, browser automation, or autonomous submission.
- No automatic email sending.
- No fabricated employers, roles, skills, projects, metrics, achievements, or STAR stories.
- No trusted Vault evidence without explicit user approval.
- Every resume version that uses Vault evidence records the evidence IDs used.
- Every AI suggestion sourced from user material shows provenance before the user can approve or use it.

---

## Requirement Categories

Use these categories when writing roadmap requirements:

| Category | Scope | Why It Matters |
|---------|-------|----------------|
| **Vault Data Model** | Profile, roles, projects, achievements, skills, certifications, STAR stories, source artifacts, approval state, provenance | Required before any evidence-backed feature can be trusted |
| **Vault Review Workflow** | Import from resumes, candidate extraction, duplicate grouping, approve/edit/merge/reject | Prevents AI extraction from silently becoming truth |
| **Evidence Retrieval and Usage** | Rank approved Vault evidence for a JD, feed tailoring, persist evidence usage per resume version | Connects existing tailoring to the new evidence system |
| **Application Workflow** | Application records, statuses, Kanban, detail pages, timeline, documents, notes | Turns completed tailoring runs into an ongoing search process |
| **CRM and Reminders** | Contacts, follow-up dates, reminder queue, snooze/dismiss, grounded drafts | Keeps the user organized without taking actions for them |
| **Discovery and Gap Analysis** | Compare approved sources/resumes, surface missing evidence candidates, reject permanently | Finds underused evidence while preserving source attribution |
| **Explainable Scoring** | Coarse fit buckets, dimension breakdowns, evidence links, hard caps, top actions | Helps decision-making without pretending to predict ATS or recruiter behavior |
| **Guardrails and Auditability** | Provenance, immutable timeline events, approval logs, confidence labels, limitation copy | Protects the evidence-first product promise |

---

## Table Stakes

Features users expect. Missing = the v4.1 product feels incomplete or untrustworthy.

### Career Vault v1

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Structured career entities** | A source-of-truth system needs more than one resume blob | High | New Vault schema | Include profile preferences, roles, projects, achievements, skills, certifications, STAR stories, and source artifacts. |
| **Source artifact registry** | Evidence must be traceable to uploaded/selected resumes and later sources | Medium | Vault schema | Store source type, filename/reference, extracted_at, parser metadata, and safe snippets or offsets where practical. |
| **Resume import candidate extraction** | Users will not manually re-enter years of career data from scratch | High | Parser/extraction service; source artifacts | Import at least two resumes per milestone scope. Extract candidates, not trusted records. |
| **Approval queue for extracted candidates** | AI extraction is fallible and cannot write trusted evidence automatically | High | Candidate tables; review UI | Candidate states: pending, approved, rejected, merged. Approved records become Vault evidence. |
| **Duplicate grouping, not silent merge** | Multiple resumes will contain overlapping roles, skills, and bullets | High | Candidate extraction; similarity logic | Show likely duplicates together and let the user merge or keep separate. |
| **Manual create/edit for all Vault records** | Users need to correct extraction errors and add missing evidence | Medium | Vault APIs and forms | Manual records still need provenance: `manual_entry`, user timestamp, and last edited timestamp. |
| **Browse and search Vault** | A vault that cannot be inspected will not be trusted | Medium | Vault APIs | Search by company, title, skill, tag, source, approval state, and record type. |
| **Provenance display on evidence** | Users must know where a claim came from | Medium | Source artifacts | Every achievement/story/skill should expose source references and approval/edit history. |
| **Approval-safe AI rewriting** | Resume-ready text can be polished, but facts cannot change | Medium | Candidate review UI; validation | AI may rewrite wording from source material, but changed metrics/claims require explicit user confirmation. |
| **Vault-backed tailoring retrieval** | Existing tailoring must use approved evidence, not raw candidates | High | Approved evidence; JD extraction; ranking | Feed ranked evidence into Resume Tailor and persist the selected evidence IDs. |
| **Resume-version evidence ledger** | Users need to audit which claims entered each generated resume | Medium | `resume_versions`; join table | Add a `resume_version_evidence` relationship rather than embedding IDs only in JSON. |

### Application Tracker MVP

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Application entity separate from pipeline job** | A tailoring run is not the same as a real application | Medium | Existing `jobs`, `resume_versions` | Link to `jobs.job_id` when created from tailoring, but allow manual records with no pipeline job. |
| **Required status workflow** | Job seekers expect a simple lifecycle board | Medium | Application schema | Required statuses: saved, applied, interviewing, offer, rejected, archived. Keep separate from existing pipeline statuses. |
| **Create manually** | Not every application starts from Rendure discovery or tailoring | Medium | Application APIs/forms | Must support company, role, URL, notes, status, contact, and follow-up dates without running the pipeline. |
| **Create from pasted job URL** | Users expect best-effort job capture from a URL | Medium | Existing job submission/scout helpers | Save the application and JD snapshot even if the user has not tailored yet. |
| **Create from tailoring result** | The current pipeline should hand off into tracking in one or two actions | Medium | Existing job detail/resume views | From approved job detail: "Save as application" with company, role, URL, JD snapshot, active resume prefilled. |
| **JD snapshot** | Listings disappear and users need the original context later | Low | Existing `jobs.jd_text` or URL scrape | Store immutable snapshot per application, not just URL. |
| **Linked documents** | Tracker must show which resume/cover letter was used | Medium | Existing `resume_versions`; future cover letters | Link active resume version now; include nullable cover letter fields for later. |
| **Kanban board** | Visual progress tracking is the default mental model for job trackers | Medium | Application statuses | Drag/drop should write status-change timeline events. |
| **Application detail page** | Users need one place for role, JD, docs, notes, contacts, timeline, and evidence | High | Application, documents, timeline, contacts | This is the workhorse view, not the board. |
| **Notes and activity timeline** | Job search is full of manual actions that must be remembered | Medium | Timeline table | Timeline should capture created, status changed, note added, document linked, contact added, reminder changed. |
| **Stale and overdue indicators** | Users need to know what requires attention today | Medium | Status dates; follow-up dates | Stale rule should be configurable by status, with sensible defaults. |

### Missing Achievement Discovery

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Compare active resume to approved sources** | Users forget strong achievements that exist in older resumes or source artifacts | High | Career Vault approved evidence; active resume parser | Compare against approved Vault/source evidence, not arbitrary AI-generated ideas. |
| **Evidence candidate cards** | Suggestions must be reviewable before use | Medium | Discovery engine; source artifacts | Candidate card: missing item, source, affected role/project, why relevant, confidence, actions. |
| **Precise source attribution** | Non-negotiable guardrail against fabricated achievements | Medium | Source artifacts; snippets/offsets | No source, no suggestion. |
| **Duplicate grouping** | Old resumes often contain similar bullets phrased differently | High | Similarity/dedupe logic | Group candidates by likely same achievement/skill/project. |
| **Add to Vault / use in active resume / reject permanently** | Users need triage actions, not just a report | High | Vault write path; tailoring/resume version path; rejection memory | "Use in active resume" should still create or reference approved Vault evidence first. |
| **Permanent rejection memory** | Rejected suggestions should not keep resurfacing | Medium | Candidate rejection table | Store source fingerprint and reason optional. |

### Recruiter CRM Lite

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Contact records** | Trackers commonly include recruiter/contact management | Medium | Applications | Fields: name, company, title/relationship, email, LinkedIn URL, phone optional, notes. |
| **Application-contact linking** | The same recruiter may be tied to multiple roles | Medium | Applications; contacts | Many-to-many is safer than embedding one contact on an application. |
| **Last contact and next follow-up dates** | Follow-up discipline is the CRM value | Low | Contact/application link | Store per application-contact relationship, not only global contact. |
| **Reminder queue** | Users need a daily list of overdue/upcoming follow-ups | Medium | Follow-up dates; status | Queue should support overdue, today, upcoming, snoozed, dismissed. |
| **Snooze and dismiss** | Reminder systems without triage become noise | Medium | Reminder events | Dismiss should preserve audit history. |
| **Grounded follow-up draft** | AI helps write concise messages, but cannot invent context | Medium | Application, contact, notes, timeline | Draft only from role, company, status, known contact details, timeline events, and user notes. |
| **Copy/export draft, no send** | The system must never email automatically | Low | Draft UI | Provide copy button and maybe mailto link only after user review; avoid API email sending in v4.1. |

### Explainable Job-Match Score

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Coarse fit bucket** | Percent scores create false precision | Medium | Vault retrieval; JD parse | Use labels like strong, plausible, stretch, poor-fit, blocked-by-constraint. Optionally show an internal numeric score in debug only. |
| **Dimension breakdown** | Users expect to know why a role is or is not a fit | High | Scoring engine | Dimensions: skills/responsibilities evidence, seniority/scope, domain/stack, logistics, optional compensation. |
| **Evidence-backed explanations** | A score without receipts is just another black box | High | Approved Vault evidence; JD evidence | Each dimension should show JD evidence and Vault/resume evidence used. |
| **Gap taxonomy** | Different gaps require different actions | Medium | Scoring rules | Distinguish missing evidence, missing demonstrated capability, hard logistical constraints, and low-confidence assessments. |
| **Top three actions** | Users need decisions, not just diagnostics | Medium | Score outputs; Vault/action links | Examples: add sourced achievement, tailor with specific approved project, skip due visa/location hard cap. |
| **Hard caps and configuration** | Some constraints should cap fit regardless of keyword match | High | Preferences; JD extraction | Location, remote, visa/work authorization, relocation, and compensation if enabled. |
| **Persist score inputs and config** | Scores must be reproducible and debuggable | Medium | Score tables | Persist dimension values, weights, hard caps, evidence links, confidence, and config version. |
| **Limitation copy** | Match score must not pretend to predict ATS or hiring outcomes | Low | Score UI | State it is a decision aid, not an ATS score, recruiter-interest prediction, or interview probability. |
| **Evaluation harness** | Deterministic scoring needs regression coverage | Medium | Test fixtures | Include representative candidate/JD pairs and expected bucket/dimension outputs. |

---

## Differentiators

Features that set Rendure apart. Not all are required in the first slice, but they define the v4.1 wedge.

| Feature | Value Proposition | Complexity | Dependencies | Recommendation |
|---------|-------------------|------------|--------------|----------------|
| **Evidence-first Vault with approval gates** | Stronger trust model than generic AI resume builders because extracted facts are candidates until approved | High | Vault schema and review UI | Build first. This is the milestone foundation. |
| **Provenance-first missing achievement discovery** | Finds forgotten material without inventing resume claims | High | Vault, source artifacts, active resume parsing | Build after Vault is usable and approved evidence exists. |
| **Tailoring evidence ledger** | Lets users audit every tailored resume claim back to approved Vault records | Medium | Vault retrieval; resume version linkage | Build with tailoring integration, not later. |
| **Explainable match score with caps and evidence links** | More honest than raw "ATS score" products and better aligned to self-hosted trust | High | Vault retrieval; scoring engine; preferences | Build after Vault retrieval, before interview prep. |
| **Application detail as command center** | Combines JD snapshot, documents, notes, contacts, follow-up, and Vault evidence | High | Tracker MVP; resume links; timeline | Make this richer than the board. The board is navigation. |
| **Grounded follow-up drafts from timeline** | Useful AI writing that cannot drift into fabricated contact history | Medium | CRM, notes, timeline | Build after reminder queue and contact data exist. |
| **Decision-oriented fit actions** | Converts a match report into concrete next steps | Medium | Explainable score; Vault actions | Prioritize over extra charts. |
| **Single-user privacy posture** | Local/self-hosted data control is a meaningful differentiator versus SaaS trackers | Low | Existing deployment model | Surface in copy sparingly; do not turn it into marketing inside core workflows. |

---

## Anti-Features

Features to explicitly not build in v4.1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Auto-apply or browser automation** | Violates product constraints and moves Rendure from decision support into untrusted submission automation | Keep "open job URL" and application logging manual. |
| **Automatic email sending** | Violates CRM scope; creates deliverability, account access, and consent complexity | Generate grounded drafts and let the user copy/send manually. |
| **Autonomous trusted Vault writes** | AI extraction errors would become resume claims | Store candidates, require explicit approval, and preserve provenance. |
| **Silent duplicate merging** | Career histories are messy; silent merges lose nuance and can corrupt dates/titles | Group likely duplicates and ask the user to merge, edit, or keep separate. |
| **Invented metric suggestions** | Placeholder metrics are dangerous in an evidence-first product | Ask the user to supply real metrics or mark metric as absent. |
| **ATS prediction claims** | Public scanner products often use match scores, but even official Jobscan copy notes the score is a visualization tool, not the ATS scoring the resume | Use coarse fit buckets and limitation copy. |
| **Generic CRM breadth** | Full CRM features create clutter for a single job seeker | Limit to contacts, notes, relationship to applications, reminders, and drafts. |
| **Email inbox parsing in v4.1** | Useful later, but explicitly out of scope and privacy-sensitive | Design timeline/event schema so email import can be added later. |
| **LinkedIn/GitHub/browser-extension import** | Explicitly out of scope for this milestone and high maintenance | Keep resume upload/selection and manual entry only. |
| **Team sharing or multi-user collaboration** | Conflicts with single-user self-hosted model and expands auth/permissions | Keep ownership boundaries in schema, but expose single-user UI only. |
| **Resume WYSIWYG editor as core workflow** | Would compete with the existing automation pipeline and add rendering complexity | Let users edit Vault evidence and regenerate/tailor; keep resume output review-focused. |
| **False-precision score dashboards** | Numeric leaderboards invite over-optimization and misplaced trust | Use explainable buckets, dimensions, evidence, and top actions. |
| **Competitive Insights blocking user features** | Internal tooling is not part of this question and must not delay Vault/Tracker foundation | Defer or parallelize only after user-facing critical path is stable. |

---

## Feature Dependencies

Build dependencies, not just preferred order:

```text
Career Vault schema
  -> source artifacts
  -> import/extraction candidates
  -> duplicate grouping
  -> approval queue
  -> approved Vault evidence
      -> browse/search/edit
      -> Vault evidence retrieval for JD
          -> tailoring integration
          -> resume_version_evidence ledger
          -> explainable match scoring
          -> missing achievement discovery

Existing tailoring result
  -> create application from job/resume version
  -> application detail + documents
  -> application timeline
  -> Kanban status board
      -> stale/overdue indicators
      -> recruiter/contact links
          -> follow-up reminder queue
          -> grounded follow-up drafts

Approved Vault evidence + application detail
  -> future Prepare Me interview prep
```

Important dependency decisions:

- Career Vault must precede Missing Achievement Discovery because discovery needs approved sources and rejection memory.
- Career Vault retrieval must precede Explainable Match Score because scores need evidence links and hard caps, not just keyword overlap.
- Application Tracker MVP must precede Recruiter CRM Lite because reminders need application status, timeline, and contact linkage.
- Tailoring integration should ship in the same phase as the first usable Vault retrieval, because otherwise the Vault is disconnected from Rendure's existing core value.
- Application status must remain separate from existing pipeline status. Do not overload `jobs.status`.

---

## MVP Recommendation

The milestone should not try to ship all v4.1 surfaces at once. The right vertical slices are:

### MVP Slice 1 - Career Vault Foundation

Prioritize:

1. Vault schema for roles, projects, achievements, skills, certifications, stories, sources, candidates, approval states.
2. Import at least two resumes into candidate records.
3. Review queue with approve/edit/reject and duplicate grouping.
4. Browse/search/edit approved Vault evidence.
5. Provenance display on every approved record.

Defer:

- Missing achievement discovery until approved evidence exists.
- Match score until retrieval can link evidence to JD requirements.

### MVP Slice 2 - Vault-Backed Tailoring

Prioritize:

1. Rank approved Vault evidence against a target JD.
2. Feed ranked evidence into Resume Tailor.
3. Persist `resume_version_evidence` links.
4. Show "evidence used" on resume/job detail.

Defer:

- Advanced retrieval tuning until there is a test harness and real examples.

### MVP Slice 3 - Application Tracker

Prioritize:

1. Application records with required statuses.
2. Create manually, from URL, and from tailoring result.
3. Link resume versions and JD snapshot.
4. Kanban board and application detail page.
5. Notes, timeline, stale indicators, and next follow-up date.

Defer:

- Calendar integration and email parsing.

### MVP Slice 4 - Missing Achievement Discovery

Prioritize:

1. Compare active resume to approved Vault/source evidence.
2. Show sourced candidate cards.
3. Actions: add to Vault, use in active/tailored resume, reject permanently.

Defer:

- Proactive discovery from LinkedIn/GitHub/performance reviews unless manually uploaded as source artifacts.

### MVP Slice 5 - Recruiter CRM Lite

Prioritize:

1. Contacts and application-contact links.
2. Reminder queue for overdue/upcoming follow-ups.
3. Snooze/dismiss.
4. Grounded follow-up drafts with copy-only workflow.

Defer:

- Sending, inbox parsing, sequences, and analytics.

### MVP Slice 6 - Explainable Match Score

Prioritize:

1. Deterministic scoring dimensions with configurable weights/caps.
2. Coarse fit buckets.
3. Evidence links per dimension.
4. Gap taxonomy and top three actions.
5. Persisted score inputs/config and small evaluation harness.
6. Limitation copy in UI.

Defer:

- Claims about ATS outcomes, interview probability, or recruiter behavior.

---

## Suggested Roadmap Phase Mapping

| Phase | Feature Set | Why This Order |
|------|-------------|----------------|
| **Phase 1 - Architecture and migration plan** | Schema boundaries, new entities, API contracts, migration ordering, compatibility plan | Prevents accidental coupling to existing `jobs.status` and protects current pipeline. |
| **Phase 2 - Career Vault schema, APIs, and retrieval primitives** | Vault tables, source artifacts, candidates, approval states, search APIs, retrieval service skeleton | Creates foundation for every other evidence-backed feature. |
| **Phase 3 - Vault review/import UI and tailoring integration** | Resume import review, duplicate grouping, approval queue, retrieval-fed tailoring, evidence ledger | Makes the Vault useful inside the existing core flow. |
| **Phase 4 - Application Tracker MVP** | Applications, Kanban, detail, timeline, document links, create from tailoring | Converts finished resume runs into an operating workflow. |
| **Phase 5 - Missing Achievement Discovery** | Sourced missing-evidence candidates, add/use/reject actions | Requires approved Vault evidence and active resume comparison. |
| **Phase 6 - Recruiter CRM Lite** | Contacts, follow-up dates, reminder queue, grounded drafts | Requires application records and timeline context. |
| **Phase 7 - Explainable Match Score** | Coarse fit buckets, dimensions, caps, evidence links, top actions, eval harness | Requires Vault retrieval and source-linked evidence. |

This ordering matches the approved design source. If implementation pressure forces cuts, cut breadth from CRM and score UI before cutting provenance, approval gates, or evidence usage logging.

---

## Complexity Summary

| Capability | Complexity | Primary Risk | Risk Control |
|------------|------------|--------------|--------------|
| Career Vault data model | High | Over-normalization or under-modeling provenance | Model queryable relationships relationally; use JSONB only for parser metadata/versioned payloads. |
| Resume import extraction | High | Bad extraction pollutes review queue | Candidate-only persistence; validation; source snippets; approval gates. |
| Duplicate grouping | High | Incorrect merges corrupt career history | Group as suggestions; never merge automatically. |
| Vault retrieval | High | Tailor chooses irrelevant or unapproved evidence | Filter to approved evidence; log rankings; test representative JD/evidence pairs. |
| Evidence ledger | Medium | Resume claims cannot be audited later | Required join table and UI display before calling Vault integration complete. |
| Application Tracker | Medium | Confuses application status with pipeline status | Separate `applications` lifecycle and timeline. |
| CRM Lite | Medium | Scope creep into full sales CRM or email client | Limit to contacts, reminders, notes, and copy-only drafts. |
| Missing Achievement Discovery | High | AI proposes unsupported claims | Enforce no-source/no-suggestion; show provenance and confidence. |
| Explainable Match Score | High | False precision and misleading ATS claims | Coarse buckets, hard caps, evidence links, limitation copy, deterministic tests. |

---

## Ecosystem Notes

- Job-search products commonly combine a tracker, resume builder, match score, and CRM/contact layer. Huntr advertises job tracking, tailored resumes, contact tracking, private notes, interview tracking, documents, and application autofill. Rendure should borrow the organizational patterns but reject autofill/auto-apply.
- Teal's current guidance frames the resume builder as a comprehensive work-history source that users tailor from, including old resumes, LinkedIn, performance reviews, and job descriptions from prior roles. Rendure's Career Vault is the stricter, provenance-aware version of that idea.
- Resume scanner products commonly report missing keywords, hard/soft skills, formatting issues, measurable results, job title/seniority alignment, and match/relevancy scores. Rendure should score fit transparently against JD and approved evidence, not claim an employer ATS will score the user.
- Missing Achievement Discovery is a product wedge because most tools identify resume-vs-JD missing keywords, but fewer enforce source-backed missing-achievement suggestions from the user's own approved materials.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Career Vault table stakes | HIGH | Approved design source plus current Teal/Huntr source-of-truth resume patterns. |
| Application Tracker table stakes | HIGH | Huntr, Teal, and Simplify all converge on saving jobs, tracking statuses, documents, notes, and job details. |
| Recruiter CRM Lite | HIGH | Huntr explicitly exposes contact tracking; Teal tracker references contact lists and email templates. |
| Missing Achievement Discovery | MEDIUM | Strongly supported by Rendure's evidence-first direction and resume-gap tools, but less common as a standalone sourced-evidence workflow. |
| Explainable Match Score | HIGH | Jobscan, Resume Worded, Huntr, Teal, and Simplify all expose match/missing-keyword concepts; Rendure's conservative scoring constraints are product-specific. |
| Anti-features | HIGH | Directly from approved milestone constraints and existing project non-negotiables. |

---

## Sources

Primary project sources:

- Approved v4.1 design source: `/Users/kaustubhtrivedi/.codex/attachments/e01e7152-f417-4224-85e3-129a934ead1b/pasted-text.txt` - HIGH confidence.
- `.planning/PROJECT.md` - current milestone goals, constraints, validated existing features - HIGH confidence.
- `README.md` - current product/API/frontend behavior and no-submit constraint - HIGH confidence.
- `frontend/app/routes/jobs.$id.tsx` - existing job-detail surface and pipeline/QA assumptions - HIGH confidence.
- `frontend/app/routes/discover.tsx` - existing discovery review and approve/reject flow - HIGH confidence.
- `api/src/routes/jobs.ts` - existing job/resume/QA/SSE API contracts - HIGH confidence.
- `api/src/routes/discovery.ts` - existing discovered-job approval and pipeline handoff - HIGH confidence.

External ecosystem sources:

- Teal job tracker and product overview: https://www.tealhq.com/tools/job-tracker and https://www.tealhq.com/ - MEDIUM confidence for market pattern.
- Teal resume builder knowledge base, updated April 2, 2026: https://help.tealhq.com/en/articles/14435724-how-to-build-your-resume-in-teal - HIGH confidence for comprehensive source-resume pattern.
- Huntr job tracker help, updated May 1, 2026: https://help.huntr.co/en/articles/9883324-job-tracker - HIGH confidence for tracker/contact/document pattern.
- Huntr base resume help, updated May 7, 2026: https://help.huntr.co/en/articles/12995548-building-your-base-resume - HIGH confidence for base-resume/profile pattern.
- Huntr product overview and AI resume builder: https://huntr.co/ and https://huntr.co/product/ai-resume-builder - MEDIUM confidence for market feature packaging.
- Jobscan resume scanner and targeted resume pages: https://www.jobscan.co/resume-scanner and https://www.jobscan.co/targeted-resume - HIGH confidence for match score, missing keyword, formatting, and limitation pattern.
- Resume Worded Targeted Resume: https://resumeworded.com/targeted-resume - MEDIUM confidence for missing skills/relevancy-score pattern.
- Simplify product overview: https://simplify.jobs/ - MEDIUM confidence for tracker/autofill/missing-keyword market pattern.
