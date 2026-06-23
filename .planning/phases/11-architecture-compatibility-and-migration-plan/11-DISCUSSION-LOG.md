# Phase 11: Architecture, Compatibility, and Migration Plan - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 11-Architecture, Compatibility, and Migration Plan
**Areas discussed:** Backward-compatible API contract, Migration and status separation, Audit and redaction policy, Guardrail test boundary

---

## Backward-Compatible API Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Additive-only compatibility | Preserve existing route paths, field meanings, statuses, SSE event names, and response semantics; allow only safely ignorable new fields. | yes |
| Exact frozen response shape | Forbid any response-shape additions to existing clients. | |
| Planner discretion | Let the planner decide compatibility boundaries per route. | |

**User's choice:** Go ahead with the recommended option.
**Notes:** Recommended option selected: additive-only compatibility. Existing clients must not see removed, renamed, narrowed, or repurposed fields.

---

## Migration and Status Separation

| Option | Description | Selected |
|--------|-------------|----------|
| Strict separation | Keep application workflow state outside `jobs.status`; additive migrations only; do not write trigger-owned columns directly. | yes |
| Compatibility scaffolding plus early feature schema | Allow limited new schema boundaries if they remain non-user-facing scaffolding. | yes |
| Planner discretion | Let the planner decide how strict separation should be. | |

**User's choice:** Go ahead with the recommended option.
**Notes:** Recommended option selected: strict status separation with additive-only migration rules. Compatibility scaffolding is allowed only when it does not ship half-built later-phase workflows.

---

## Audit and Redaction Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Pipeline-only events plus redacted metadata | Keep `pipeline_events` for lifecycle/debugging only; use IDs, counts, summaries, hashes, and redacted snippets for sensitive content. | yes |
| Store richer raw audit content | Preserve more private prompt, Vault, recruiter, and generated content for debugging. | |
| Planner discretion | Let the planner decide log and audit retention by surface. | |

**User's choice:** Go ahead with the recommended option.
**Notes:** Recommended option selected: pipeline audit rows remain pipeline-only, while app actions use a separate application timeline. Avoid raw private content unless required for a user-visible artifact.

---

## Guardrail Test Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Blocking guardrail suite | Require tests for no-Vault fallback, approval-gated evidence writes, source-required missing evidence, application status separation, no auto-apply, and no automatic email sending. | yes |
| Advisory guardrail suite | Add tests where convenient, but do not block later phases. | |
| Planner discretion | Let the planner decide which guardrails are blocking. | |

**User's choice:** Go ahead with the recommended option.
**Notes:** Recommended option selected: all listed guardrail tests are blocking compatibility gates for downstream v4.1 phases.

---

## the agent's Discretion

- Planner may choose the exact PLAN.md split.
- Planner may choose whether compatibility scaffolding is implemented as tests, helper functions, route adapters, schema boundaries, or documentation, as long as the locked decisions are preserved.

## Deferred Ideas

None.
