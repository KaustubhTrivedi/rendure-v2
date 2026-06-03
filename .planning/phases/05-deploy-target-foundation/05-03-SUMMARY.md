---
phase: 05-deploy-target-foundation
plan: 03
type: execute
wave: 1
subsystem: config
tags: [env, templates, gitignore, config, deployment-targets, d-08, d-09, d-10]
requires:
  - plan: 05-01
    provides: TS config module + DEPLOY_TARGET convention
  - plan: 05-02
    provides: Python config module + cross-language parity
affects:
  - .gitignore (negated ignore patterns for new templates)
  - README.md (new Per-Target Env Templates section)
provides:
  - CONFIG-02 (Committed per-target placeholder-only env templates)
key-files:
  created:
    - .env.self-hosted
    - .env.cloud
    - .env.browser
  modified:
    - .gitignore
    - README.md
tech-stack:
  added: []
  patterns:
    - "DEPLOY_TARGET=<target> as first line of env template"
    - "Negated gitignore patterns for trackable env templates"
decisions:
  - D-08: New per-target templates documented alongside existing dev/prod files
  - D-09: Each template lists only vars its target actually uses
  - D-10: Placeholder-only secrets (changeme, <generate-with-openssl>); no real keys
metrics:
  duration: "~3 min"
  completed_date: "2026-05-30"
---

# Phase 5 Plan 3: Per-target Env Templates — Summary

One-liner: Add three per-target `.env.{self-hosted,cloud,browser}` templates with
placeholder-only secrets, make them git-trackable via negated ignore patterns, and
document their relationship to the existing dev/prod env files in the README.

## Tasks Executed

| # | Type | Name | Commit | Key Files |
|---|------|------|--------|-----------|
| 1 | auto | Make new templates trackable in .gitignore | `de9ab14` | .gitignore |
| 2 | auto | Write the three per-target env templates (placeholders only) | `cd984f9` | .env.self-hosted, .env.cloud, .env.browser |
| 3 | auto | Document per-target templates in README | `9c214e0` | README.md |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

| Check | Status |
|-------|--------|
| All three templates trackable (`git check-ignore` exits 1) | ✅ |
| No real 64-char hex keys in any template | ✅ |
| Existing `.env.dev.example` / `.env.production.example` unchanged | ✅ |
| `.gitignore` has correct negations for all three templates | ✅ |
| `DEPLOY_TARGET=<target>` is first line of every template | ✅ |
| `DATABASE_URL` present in self-hosted, absent in browser (with comment) | ✅ |
| README mentions DEPLOY_TARGET, all three templates, and existing dev/prod files | ✅ |

## Key Decisions Applied

### D-08 — Existing dev/prod files unchanged, new templates documented in README
The README now has a "Per-Target Env Templates" section explaining the three `DEPLOY_TARGET`
values and how they relate to the existing `.env.dev.example` / `.env.production.example`
files (which continue to serve docker-compose dev/prod splits).

### D-09 — Target-appropriate var sets only
Each template lists only the env vars that target actually uses:
- **self-hosted**: DATABASE_URL, all pipeline agent vars, Codex OAuth, Telegram, Jina
- **cloud**: DATABASE_URL, centralized keys, Phase 9 seam comment (no fabricated vars)
- **browser**: No DATABASE_URL (PGlite/IndexedDB comment), no server OPENROUTER_API_KEY
  (BYOK), minimal scraper-touching vars only

### D-10 — Placeholder-only secrets
All secret values use unmistakable placeholders:
- API keys: `changeme-...`
- PROFILE_ENCRYPTION_KEY: `<generate-with-openssl>`
- No real 64-character hex strings committed

## Threat Model Compliance

| Threat | Disposition | Verification |
|--------|-------------|--------------|
| T-05-07: Information Disclosure via templates | Mitigated — placeholder-only values, grep-verified no hex keys | `grep -c PROFILE_ENCRYPTION_KEY=hex` = 0 across all templates |
| T-05-08: .gitignore change leaks real env files | Mitigated — negations target only three specific templates; `.env.*` broad ignore retained | Verified `grep -c '^\.env\.\*$' .gitignore` = 1 |
| T-05-09: Existing prod example has real-looking key | Accepted — out of scope per D-10 (deferred to cleanup phase) | Existing file unchanged |

## Known Stubs

None — all three templates are fully functional placeholder config files.

## Summary of Work

Three template files committed: `.env.self-hosted` (canonical self-hosted with DATABASE_URL +
all pipeline vars), `.env.cloud` (managed Postgres + centralized keys + Phase 9 seam note),
`.env.browser` (no DATABASE_URL, BYOK OpenRouter, server-minimal config). Gitignore updated
with three negated patterns so the templates are trackable while real `.env`/`.env.*` files
remain ignored. README extended with a dedicated per-target section explaining the
`DEPLOY_TARGET` convention and the relationship to the existing dev/prod env files.

## Self-Check: PASSED

All three template files exist on disk:
- ✅ `.env.self-hosted`
- ✅ `.env.cloud`
- ✅ `.env.browser`

All three commits exist in git log:
- ✅ `de9ab14`
- ✅ `cd984f9`
- ✅ `9c214e0`

All verification checks pass.
