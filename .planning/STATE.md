---
gsd_state_version: 1.0
milestone: v4.1
milestone_name: Job Search Operating System v1
current_phase: 18
current_phase_name: automatic-application-submission
status: complete
stopped_at: Phase 18 shipped — PR #13
last_updated: "2026-07-01T00:00:00Z"
last_activity: 2026-07-01
last_activity_desc: Phase 18 executed and verified
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A job seeker pastes a URL and gets back a tailored, high-quality resume without touching a single line of their resume themselves.
**Current focus:** Phase 18 — automatic-application-submission

## Current Position

Phase: 18 (automatic-application-submission) — COMPLETE
Plan: 6 of 6
Status: Verified complete
Last activity: 2026-06-30 — Phase 18 executed and verified

Progress: [##########] 100%

## Performance Metrics

| Phase | Plans Complete | Status |
|-------|----------------|--------|
| 11 | 4/4 | Complete |
| 12 | 0/? | Not started |
| 13 | 0/? | Not started |
| 14 | 0/? | Not started |
| 15 | 0/? | Not started |
| 16 | 0/? | Not started |
| 17 | 0/? | Not started |
| 18 | 6/6 | Complete |

## Accumulated Context

### Decisions

- 2026-06-23: v4.1 phase numbering continues after previous Phase 10b; active roadmap uses Phases 11-17.
- 2026-06-23: v4.1 roadmap follows the researched delivery order: compatibility guardrails, Career Vault foundation, import/review plus tailoring, application tracker, discovery, CRM, then match scoring.
- 2026-06-23: Existing URL-to-tailored-resume flow remains load-bearing and must work without Vault setup.
- 2026-06-23: Trusted Vault evidence requires explicit user approval; AI can create candidates, rank evidence, and draft text only from user-provided sources.
- 2026-06-23: Application status, application timeline, recruiter reminders, and match assessments are separate from pipeline `jobs.status`, `pipeline_events`, and QA score semantics.

### Roadmap Evolution

- Phase 18 added: Automatic Application Submission (Greenhouse, Lever, Ashby portal agents)
- Phase 18 executed: ATS detection, submission schema, screening answer engine, resume rendering, Greenhouse/Lever/Ashby portal agents, portal router, and `--auto-apply` opt-in wiring.

### Pending Todos

- Legacy Clerk-based tests and DB migrations from v2.0 should be cleaned up when relevant; not a blocker for v4.1 roadmap planning.

### Blockers/Concerns

None currently.

## Session Continuity

Last session: 2026-07-02
Stopped at: Session resumed. Pushed agent prompt improvements (feat/career-vault). Proceeding to finish incomplete plan 12-02.
Resume file: .planning/phases/12-career-vault-schema-and-api-foundation/12-02-PLAN.md
Next action: Execute plan 12-02 — implement /vault Hono router + mount, turn vault.test.ts green.
