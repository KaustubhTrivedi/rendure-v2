---
phase: 11
slug: architecture-compatibility-and-migration-plan
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
---

# Phase 11 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **API framework** | Vitest 4.1.5 via `npm test` in `api/` |
| **API config file** | none detected; script is in `api/package.json` |
| **Python framework** | pytest 9.0.3 via `uv run pytest` |
| **Python config file** | `pyproject.toml` |
| **Frontend check** | `cd frontend && npm run typecheck` |
| **Quick run command** | plan-specific command from the task table below |
| **Full suite command** | `cd api && npm test`; `uv run pytest tests/`; `cd frontend && npm run typecheck` |
| **Estimated quick runtime** | 5-45 seconds per focused command |
| **Estimated full runtime** | 2-4 minutes based on research baseline |

---

## Sampling Rate

- **After every task commit:** Run the task's focused command from the table below.
- **After every plan completion:** Run all focused commands for that PLAN.md.
- **After Wave 1:** Run `cd api && npm test`, `uv run pytest tests/`, and `cd frontend && npm run typecheck`.
- **Before `$gsd-verify-work`:** Full API tests, full Python tests, and frontend typecheck must be green.
- **Max feedback latency:** 4 minutes for the full phase gate; under 45 seconds for focused task checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | COMPAT-01, GUARD-06 | T-11-01 | URL submission has no Vault/application prerequisite. | API unit | `cd api && npm test -- job-submission.test.ts` | yes | pending |
| 11-01-02 | 01 | 1 | COMPAT-02 | T-11-04 | Existing job/resume/PDF/QA route fields and content types remain stable. | API route | `cd api && npm test -- routes/jobs.test.ts` | yes | pending |
| 11-01-03 | 01 | 1 | COMPAT-02, COMPAT-06 | T-11-02, T-11-03 | SSE event name and payload allowlist remain stable; DB `payload` is excluded. | API route/serializer | `cd api && npm test -- routes/jobs.test.ts` | yes | pending |
| 11-02-01 | 02 | 1 | COMPAT-03 | T-11-05 | Phase 11 migration is additive and does not write trigger-owned job columns. | SQL static | `cd api && npm test -- compat-boundaries.test.ts` | Wave 0 creates | pending |
| 11-02-02 | 02 | 1 | COMPAT-04 | T-11-06 | Application statuses do not pollute `jobs.status`, `allowed_transitions`, or SSE terminal statuses. | SQL/static | `cd api && npm test -- compat-boundaries.test.ts` | Wave 0 creates | pending |
| 11-02-03 | 02 | 1 | COMPAT-05 | T-11-07, T-11-08 | Application timeline/audit storage is separate from `pipeline_events`. | SQL/static | `cd api && npm test -- compat-boundaries.test.ts` | Wave 0 creates | pending |
| 11-03-01 | 03 | 1 | COMPAT-06, GUARD-06 | T-11-09, T-11-11, T-11-12 | Prompt audit redaction helper is JSON-safe and Resume Tailor prompt traces store hash/length/redaction metadata, not raw prompt content. | Python unit/agent | `uv run pytest tests/test_audit_redaction.py tests/test_resume_tailor.py -x` | Wave 0 creates | pending |
| 11-03-02 | 03 | 1 | COMPAT-01, GUARD-06 | T-11-08A | Resume Tailor treats future Vault absence or empty approved evidence as optional. | Python agent | `uv run pytest tests/test_resume_tailor.py -x` | yes | pending |
| 11-03-03 | 03 | 1 | COMPAT-06, GUARD-06 | T-11-10, T-11-11 | Quality Analyst prompt trace stores hash/length/redaction metadata, not raw prompt content. | Python agent | `uv run pytest tests/test_quality_analyst.py -x` | yes | pending |
| 11-04-01 | 04 | 1 | GUARD-06, COMPAT-06 | T-11-13 | Trusted evidence writes require user approval plus source or manual-entry metadata. | API unit | `cd api && npm test -- safety-guardrails.test.ts` | Wave 0 creates | pending |
| 11-04-02 | 04 | 1 | GUARD-06, COMPAT-06 | T-11-14, T-11-15 | Missing evidence requires source attribution; submit/apply/send actions are rejected. | API unit | `cd api && npm test -- safety-guardrails.test.ts` | Wave 0 creates | pending |
| 11-04-03 | 04 | 1 | GUARD-06 | T-11-16 | Production source has tripwires against automatic email sending and auto-apply/browser automation. | API static | `cd api && npm test -- safety-guardrails.test.ts no-automation-boundaries.test.ts` | Wave 0 creates | pending |

*Status values: pending, green, red, flaky.*

---

## Wave 0 Requirements

- `api/src/compat-boundaries.test.ts` - created by Plan 02 Task 1 before `database/008_compat_boundaries.sql`.
- `database/008_compat_boundaries.sql` - created by Plan 02 Task 1 after the RED static tests.
- `tests/test_audit_redaction.py` - created by Plan 03 Task 1 before `utils/audit_redaction.py`.
- `utils/audit_redaction.py` - created by Plan 03 Task 1 after the RED helper tests.
- `api/src/safety-guardrails.test.ts` - created by Plan 04 Task 1 before `api/src/safety-guardrails.ts`.
- `api/src/safety-guardrails.ts` - created by Plan 04 Task 1 after the RED guardrail tests.
- `api/src/no-automation-boundaries.test.ts` - created by Plan 04 Task 3.

Existing infrastructure covers all test framework needs; no package installation is planned.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Existing live `llm_prompt_trace` row cleanup | COMPAT-06 | No live database client/connection was available during planning, and retention policy needs operator approval. | Optional post-phase operator task: inspect live `pipeline_events` rows with `event_type = 'llm_prompt_trace'`; decide separately whether redaction cleanup is required. This is not required for Phase 11 execution. |

All Phase 11 deliverable behaviors have automated verification; the manual item is live-data maintenance only.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or explicit Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing test/helper references.
- [x] No watch-mode flags are used.
- [x] Feedback latency target is under 4 minutes for the full phase gate.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** approved 2026-06-23
