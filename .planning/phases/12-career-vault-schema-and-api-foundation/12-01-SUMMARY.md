---
phase: 12-career-vault-schema-and-api-foundation
plan: 01
subsystem: database, api, testing
tags: [career-vault, postgres, pglite, vitest, provenance, guardrails]
requires:
  - phase: 11-architecture-compatibility-and-migration-plan
    provides: compatibility boundaries and guardrail test conventions
provides:
  - Career Vault additive schema migration
  - RED /vault route contract tests
  - Provenance and trusted-write guardrail test surface
affects: [phase-12, vault-api, evidence-provenance, guardrails]
tech-stack:
  added: []
  patterns: [additive SQL migration, PGlite-portable triggers, mocked pool.query route tests]
key-files:
  created:
    - database/009_career_vault.sql
    - api/src/routes/vault.test.ts
  modified: []
key-decisions:
  - "Vault evidence uses one table per entity with approval_state on the row."
  - "record_provenance.record_id and vault_story_links.linked_id remain polymorphic without hard foreign keys."
patterns-established:
  - "Vault migrations avoid pipeline tables, pg_notify, concurrent indexes, generated columns, and hard FKs on polymorphic IDs."
  - "Vault route tests mock only pool.query and leave safety-guardrails unmocked."
requirements-completed: [VAULT-01, VAULT-02, VAULT-03, VAULT-04, VAULT-05, VAULT-06, VAULT-07, VAULT-08, VAULT-09, GUARD-01, GUARD-02]
duration: 25min
completed: 2026-06-30
status: complete
---

# Phase 12 Plan 01 Summary

**Career Vault schema migration plus RED /vault HTTP contract tests for source artifacts, profile preferences, entity candidates, and provenance-gated approvals**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-30T08:09:00Z
- **Completed:** 2026-06-30T08:34:26Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `database/009_career_vault.sql` with all ten Career Vault tables, indexes, single-row `vault_profile` seed, and last-user-edit triggers.
- Added `api/src/routes/vault.test.ts` with RED tests covering `/vault/sources`, `/vault/profile`, every Vault entity route family, approval guardrail behavior, provenance success paths, and API-key protection.
- Verified the new migration does not trip the existing compatibility boundary checks.

## Task Commits

1. **Task 1: Write additive migration** - `00daa23` (`feat(vault): add career vault schema migration`)
2. **Task 2: Write failing vault.test.ts RED stubs** - `b74045f` (`test(vault): define career vault route contract`)

## Files Created/Modified

- `database/009_career_vault.sql` - Additive Career Vault schema with source artifacts, profile preferences, roles, projects, achievements, skills, certifications, STAR stories, story links, and provenance.
- `api/src/routes/vault.test.ts` - RED contract tests for the planned `/vault` router and trusted-evidence guardrail integration.

## Decisions Made

- Kept Vault migration independent from application tracker and pipeline-owned tables.
- Used a shared `vault_set_last_user_edit()` trigger function across Vault tables to avoid repeated trigger bodies.
- Let the RED test suite fail with 404s until plan 12-02 creates and mounts `api/src/routes/vault.ts`.

## Deviations from Plan

None - plan executed as written. The only runtime adjustment was orchestration-level: typed `gsd-executor` dispatch failed model resolution in this Codex session, so execution proceeded inline while preserving task boundaries and commits.

## Issues Encountered

- Git writes were blocked by the sandbox until escalated approval allowed the required atomic commits.
- `cd api && npm test -- vault.test.ts` failed as expected with 28 route/middleware 404 failures because `/vault` is not mounted yet.

## Verification

- `cd api && npm test -- compat-boundaries.test.ts` - PASS, 5 tests.
- `grep -v '^--' database/009_career_vault.sql | grep -c 'CHECK (approval_state IN'` - PASS, returned `7`.
- Forbidden migration pattern scan - PASS, no matches.
- `cd api && npm test -- vault.test.ts` - EXPECTED RED, 28 failures, all from missing `/vault` mount/routes returning 404.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 12-02 can implement the `/vault` router, mount it behind `apiKeyMiddleware`, and turn the profile/source slices of `vault.test.ts` green.

---
*Phase: 12-career-vault-schema-and-api-foundation*
*Completed: 2026-06-30*
