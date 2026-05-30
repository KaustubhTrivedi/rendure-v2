---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Config-driven Multi-target Deployment
status: in_progress
stopped_at: ""
last_updated: "2026-05-30T11:46:57.000Z"
last_activity: 2026-05-30 — Plan 05-03 complete (per-target env templates + gitignore + README)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 3
  completed_plans: 2
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-30)

**Core value:** A job seeker pastes a URL and gets back a tailored, high-quality resume without touching a single line of their resume themselves.
**Current focus:** Phase 5 — DEPLOY_TARGET Foundation (plan 1/3 complete)

## Current Position

Phase: 5 — DEPLOY_TARGET Foundation
Plan: 03 — Per-target env templates + gitignore + README (DONE)
Status: Plan 05-03 complete — 3 tasks committed, three .env.{target} templates created, .gitignore updated, README extended
Next: Plan 05-02 — Python frozen dataclass config module + cross-language parity tests (blocking — run after 05-03)
Last activity: 2026-05-30 — Plan 05-03 complete (per-target env templates + gitignore + README)

Progress: [######----] 67% (2/3 plans complete in Phase 5)

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files | Tests |
|-------|------|----------|-------|-------|-------|
| 04-01 | 01 | 4 min | 3 | 3 | 37 |
| 04-02 | 02 | 12 min | 3 | 2 | 9 |
| 04-03 | 03 | 2 min | 3 | 4 | 19 |
| 04-04 | 04 | 9 min | 3 | 4 | 18 |
| 05-01 | 01 | 2 min | 3 | 3 | 10 |
| 05-03 | 03 | 3 min | 3 | 5 | — |

## Accumulated Context

### Decisions (v4.0)

- 2026-05-30: Browser phase split into 10a (DB & Assets) and 10b (Orchestration & BYOK) — the browser target carries 5 requirements that form two distinct delivery boundaries: the storage/asset layer must exist before the orchestration loop can run
- 2026-05-30: Phase ordering: 5 (config) → 6 (seams) → 7 (agents) + 8 (scraper, parallel-eligible after 6) → 9 (cloud) → 10a → 10b; cloud and browser both depend on seams + stateless agents
- 2026-05-30: Self-hosted constraint is hard: every phase detail section that touches the self-hosted path includes a green-suite success criterion — it is never "temporarily broken"
- 2026-05-30: DEPLOY_TARGET config module is dual-language (TS for the Hono API, Python for agents); both must default to `self-hosted` when the env var is absent
- 2026-05-30: Separate pure resolve() from frozen config singleton — tests import resolve dynamically (vi.resetModules + dynamic await import) to avoid the singleton throwing in test env on missing DATABASE_URL; tests set DATABASE_URL in beforeAll/beforeEach matching app.test.ts pattern
- 2026-05-30: Deep-freeze (Object.freeze on each nested seam sub-object, not just the top) — shallow freeze leaves db/execution/credentials mutable
- 2026-05-30: Shared parity fixture anchored at repo-root tests/fixtures/ — read by vitest via fileURLToPath + readFileSync idiom matching existing index.ts pattern
- 2026-05-30: Per-target env templates (D-08/D-09/D-10): three .env.{target} files committed with placeholder-only secrets (changeme, <generate-with-openssl>); each template lists only its target's actual vars; existing .env.dev.example/.env.production.example unchanged; README documents relationship

### Decisions (v3.0, still relevant)

- 2026-05-13: Drop Clerk auth — open-source self-hosted, single API key (`RENDURE_API_KEY`)
- 2026-05-13: Keep Hono/TypeScript backend (`api/`) — FastAPI rebuild dropped
- 2026-05-13: Single-user mode — one `user_profile` row, no multi-tenant identity
- 2026-05-13: Add Telegram bot as a first-class client
- 2026-05-21: Shared job submission helper uses discriminated union result type
- 2026-05-21: pg notification treated as wake-up only — re-queries canonical rows with parameterized SQL
- 2026-05-21: Recipient comes only from `user_profile.notify_telegram_chat_id`, never from incoming payloads

### Decisions (carry-over, always relevant)

- Pipeline agents and Postgres schema unchanged — schema runs unmodified in Postgres and PGlite
- Frontend bootstrap (`frontend/` — Vite + React 19 + React Compiler) — built as part of Phase 10a/10b
- Deploy target: Docker self-hosted via Dokploy + Traefik

### Pending Todos

- Legacy Clerk-based tests and DB migrations from v2.0 should be cleaned up — not a blocker but worth scheduling before Phase 6

### Blockers/Concerns

None currently.

### Quick Tasks Completed

*(v3.0 history — Phases 1-4 complete. See `.planning/phases/` for summaries.)*

## Session Continuity

Last session: 2026-05-30T10:22:08.695Z
Stopped at: Phase 5 context gathered
Resume file: .planning/phases/05-deploy-target-foundation/05-CONTEXT.md
Next action: `/gsd-plan-phase 5`
