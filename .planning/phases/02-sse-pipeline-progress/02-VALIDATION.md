---
phase: 02
slug: sse-pipeline-progress
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-13
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 |
| **Config file** | none — default Vitest config via `api/package.json` |
| **Quick run command** | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts` |
| **Full suite command** | `cd api && node node_modules/vitest/vitest.mjs run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts`
- **After every plan wave:** Run `cd api && node node_modules/vitest/vitest.mjs run`
- **Before `/gsd-verify-work`:** Full suite and TypeScript build must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | SSE-01, SSE-02, SSE-03, SSE-04 | T-02-03 | Stream cleans up timers/listeners and emits expected frames | unit/route | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | SSE-05 | T-02-01, T-02-02 | Missing API key returns 401; missing job returns 404 before stream starts | route | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts src/middleware/apiKey.test.ts` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 2 | SSE-01, SSE-02 | T-02-02, T-02-04 | Database trigger notifies only identifiers; route re-queries canonical rows | migration/route | `cd api && node node_modules/vitest/vitest.mjs run src/pg-listener.test.ts` | ✅ / ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | SSE-01, SSE-03, SSE-04 | T-02-03 | SSE route replays, streams live rows, sends keepalive, closes on terminal | integration | `cd api && node node_modules/vitest/vitest.mjs run src/routes/jobs.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `api/src/routes/jobs.test.ts` — add/extend tests for replay, `Last-Event-ID`, keepalive, live delivery, terminal close, missing job, and app-level auth inheritance.
- [ ] `database/003_pipeline_events_notify.sql` — migration adding the `pipeline_events` notification function and trigger.
- [ ] `database/schema.sql` — schema mirror of the notification function and trigger.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
